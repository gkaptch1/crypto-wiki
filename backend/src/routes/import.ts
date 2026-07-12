import { schemas, extractFromLatex } from '@crypto-wiki/shared';
import { sendError } from '../lib/errors';
import { requireEditor } from '../lib/session';
import { ArxivFetchError, fetchArxivSource } from '../lib/arxiv';
import { EprintFetchError, fetchEprintPdf, MAX_PDF_BYTES } from '../lib/eprint';
import { llmExtractFromPdf, PdfImportError } from '../lib/pdf-extract';
import { scoutPdf } from '../lib/pdf-scout';
import { resolveCitation, CitationFetchError } from '../lib/citation';
import type { AppInstance } from '../app';

// Paper importer, step 1 of the scan-then-select flow (PLAN.md Phase 3):
// submit LaTeX source (pasted/uploaded files, or an arXiv id the server
// fetches) OR a PDF (an ePrint id the server fetches, or an upload — the
// PDF/LLM stage), get back the extraction — candidate definitions, the macro
// table, theorem envs, warnings. **Nothing is created here.** Step 2 (the
// select) goes through the ordinary editor CRUD, which is what enforces
// slugs, roles, and draft-only creation.

const AUTH_ERRORS = { 401: schemas.ApiError, 403: schemas.ApiError };

/** Whole-paper sources; the iO worst case is ~2 MB of .tex, leave headroom. */
const SCAN_BODY_LIMIT = 32 * 1024 * 1024;

const PDF_ERRORS = { 404: schemas.ApiError, 422: schemas.ApiError, 502: schemas.ApiError, 503: schemas.ApiError };

type PdfSource = { eprintId?: string; pdfBase64?: string; pdfName?: string };
type AcquiredPdf =
  | { ok: true; pdf: Buffer; name: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Fetch an ePrint PDF by id or decode an uploaded base64 one — the shared front
 * end of every PDF route (scan / scout / extract). Returns a validated buffer
 * and a provenance name, or a structured error the caller passes to sendError.
 * Stateless by design: the PDF is re-sent for the extract step (the scout is
 * deterministic, so it re-derives the same candidate indices).
 */
async function acquirePdf(src: PdfSource): Promise<AcquiredPdf> {
  if (src.eprintId !== undefined) {
    try {
      const pdf = await fetchEprintPdf(src.eprintId);
      return { ok: true, pdf, name: `eprint-${src.eprintId.replace('/', '-')}.pdf` };
    } catch (err) {
      if (err instanceof EprintFetchError) {
        return { ok: false, status: err.statusCode, code: err.code, message: err.message };
      }
      throw err;
    }
  }
  if (src.pdfBase64 !== undefined) {
    const pdf = Buffer.from(src.pdfBase64, 'base64');
    if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
      return { ok: false, status: 422, code: 'BAD_PDF', message: 'That upload is not a PDF.' };
    }
    if (pdf.length > MAX_PDF_BYTES) {
      return { ok: false, status: 422, code: 'PDF_TOO_LARGE', message: 'The PDF is too large to import.' };
    }
    return { ok: true, pdf, name: src.pdfName?.trim() || 'uploaded.pdf' };
  }
  return {
    ok: false,
    status: 400,
    code: 'BAD_INPUT',
    message: 'Provide exactly one of "eprintId" or "pdfBase64".',
  };
}

export async function importRoutes(app: AppInstance) {
  app.post(
    '/import/scan',
    {
      preHandler: requireEditor,
      bodyLimit: SCAN_BODY_LIMIT,
      schema: {
        body: schemas.ImportScanBody,
        response: {
          200: schemas.ImportScanResult,
          400: schemas.ApiError,
          404: schemas.ApiError,
          422: schemas.ApiError,
          502: schemas.ApiError,
          503: schemas.ApiError,
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const { files, mainFile, arxivId, eprintId, pdfBase64, pdfName, pdfMode } = request.body;
      const inputs = [files, arxivId, eprintId, pdfBase64].filter((v) => v !== undefined);
      if (inputs.length !== 1) {
        return sendError(
          reply,
          400,
          'BAD_INPUT',
          'Provide exactly one of "files", "arxivId", "eprintId", or "pdfBase64".',
        );
      }

      // ---- PDF/LLM stage: ePrint fetch-by-id or an uploaded PDF
      if (eprintId !== undefined || pdfBase64 !== undefined) {
        const acquired = await acquirePdf({ eprintId, pdfBase64, pdfName });
        if (!acquired.ok) {
          return sendError(reply, acquired.status, acquired.code, acquired.message);
        }
        try {
          return await llmExtractFromPdf(acquired.pdf, { pdfName: acquired.name, mode: pdfMode });
        } catch (err) {
          if (err instanceof PdfImportError) {
            return sendError(reply, err.statusCode, err.code, err.message);
          }
          throw err;
        }
      }

      // ---- deterministic LaTeX-source paths
      let sources: Record<string, string>;
      if (arxivId !== undefined) {
        try {
          sources = await fetchArxivSource(arxivId);
        } catch (err) {
          if (err instanceof ArxivFetchError) {
            return sendError(reply, err.statusCode, err.code, err.message);
          }
          throw err;
        }
      } else {
        sources = files!;
        if (Object.keys(sources).length === 0) {
          return sendError(reply, 400, 'BAD_INPUT', '"files" must contain at least one file.');
        }
      }

      try {
        return extractFromLatex(sources, mainFile !== undefined ? { mainFile } : {});
      } catch (err) {
        // the only throw in extractFromLatex: mainFile not among the inputs
        return sendError(reply, 400, 'BAD_INPUT', (err as Error).message);
      }
    },
  );

  // Scout-first PDF import, step 1: the free, zero-token text-layer scan. Returns
  // the candidate headings + pages so the user can tick exactly the blocks they
  // want before any tokens are spent. Creates nothing; sends nothing to the LLM.
  app.post(
    '/import/scout',
    {
      preHandler: requireEditor,
      bodyLimit: SCAN_BODY_LIMIT,
      schema: {
        body: schemas.ImportScoutBody,
        response: { 200: schemas.ImportScoutResult, 400: schemas.ApiError, ...PDF_ERRORS, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { eprintId, pdfBase64, pdfName } = request.body;
      if ([eprintId, pdfBase64].filter((v) => v !== undefined).length !== 1) {
        return sendError(reply, 400, 'BAD_INPUT', 'Provide exactly one of "eprintId" or "pdfBase64".');
      }
      const acquired = await acquirePdf({ eprintId, pdfBase64, pdfName });
      if (!acquired.ok) return sendError(reply, acquired.status, acquired.code, acquired.message);
      try {
        return await scoutPdf(acquired.pdf);
      } catch {
        return sendError(reply, 422, 'BAD_PDF', 'Could not read that PDF.');
      }
    },
  );

  // Scout-first PDF import, step 2: the LLM extract, but only over the pages of
  // the blocks the user selected (indices into the scout result). The big token
  // saver — and the same ImportScanResult the select step already consumes.
  app.post(
    '/import/extract',
    {
      preHandler: requireEditor,
      bodyLimit: SCAN_BODY_LIMIT,
      schema: {
        body: schemas.ImportExtractBody,
        response: { 200: schemas.ImportScanResult, 400: schemas.ApiError, ...PDF_ERRORS, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { eprintId, pdfBase64, pdfName, selection } = request.body;
      if ([eprintId, pdfBase64].filter((v) => v !== undefined).length !== 1) {
        return sendError(reply, 400, 'BAD_INPUT', 'Provide exactly one of "eprintId" or "pdfBase64".');
      }
      const acquired = await acquirePdf({ eprintId, pdfBase64, pdfName });
      if (!acquired.ok) return sendError(reply, acquired.status, acquired.code, acquired.message);
      try {
        return await llmExtractFromPdf(acquired.pdf, { pdfName: acquired.name, selection });
      } catch (err) {
        if (err instanceof PdfImportError) {
          return sendError(reply, err.statusCode, err.code, err.message);
        }
        throw err;
      }
    },
  );

  // Citation auto-import: resolve an arXiv/ePrint/DBLP id or pasted BibTeX into
  // citation fields the select step prefills. Creates nothing.
  app.post(
    '/import/citation',
    {
      preHandler: requireEditor,
      schema: {
        body: schemas.CitationLookupBody,
        response: {
          200: schemas.CitationLookupResult,
          400: schemas.ApiError,
          404: schemas.ApiError,
          502: schemas.ApiError,
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const { arxivId, eprintId, dblpKey, bibtex } = request.body;
      const inputs = [arxivId, eprintId, dblpKey, bibtex].filter((v) => v !== undefined);
      if (inputs.length !== 1) {
        return sendError(
          reply,
          400,
          'BAD_INPUT',
          'Provide exactly one of "arxivId", "eprintId", "dblpKey", or "bibtex".',
        );
      }
      try {
        return await resolveCitation({ arxivId, eprintId, dblpKey, bibtex });
      } catch (err) {
        if (err instanceof CitationFetchError) {
          return sendError(reply, err.statusCode, err.code, err.message);
        }
        throw err;
      }
    },
  );
}
