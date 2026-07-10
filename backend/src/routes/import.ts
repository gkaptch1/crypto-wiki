import { schemas, extractFromLatex } from '@crypto-wiki/shared';
import { sendError } from '../lib/errors';
import { requireEditor } from '../lib/session';
import { ArxivFetchError, fetchArxivSource } from '../lib/arxiv';
import { EprintFetchError, fetchEprintPdf, MAX_PDF_BYTES } from '../lib/eprint';
import { llmExtractFromPdf, PdfImportError } from '../lib/pdf-extract';
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
        let pdf: Buffer;
        let name: string;
        if (eprintId !== undefined) {
          try {
            pdf = await fetchEprintPdf(eprintId);
          } catch (err) {
            if (err instanceof EprintFetchError) {
              return sendError(reply, err.statusCode, err.code, err.message);
            }
            throw err;
          }
          name = `eprint-${eprintId.replace('/', '-')}.pdf`;
        } else {
          pdf = Buffer.from(pdfBase64!, 'base64');
          if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
            return sendError(reply, 422, 'BAD_PDF', 'That upload is not a PDF.');
          }
          if (pdf.length > MAX_PDF_BYTES) {
            return sendError(reply, 422, 'PDF_TOO_LARGE', 'The PDF is too large to import.');
          }
          name = pdfName?.trim() || 'uploaded.pdf';
        }
        try {
          return await llmExtractFromPdf(pdf, { pdfName: name, mode: pdfMode });
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
