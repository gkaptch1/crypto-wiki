import { schemas, extractFromLatex } from '@crypto-wiki/shared';
import { sendError } from '../lib/errors';
import { requireEditor } from '../lib/session';
import { ArxivFetchError, fetchArxivSource } from '../lib/arxiv';
import type { AppInstance } from '../app';

// Paper importer, step 1 of the scan-then-select flow (PLAN.md Phase 3):
// submit LaTeX source (pasted/uploaded files, or an arXiv id the server
// fetches), get back the extraction — candidate definitions, the macro
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
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const { files, mainFile, arxivId } = request.body;
      if ((files === undefined) === (arxivId === undefined)) {
        return sendError(reply, 400, 'BAD_INPUT', 'Provide exactly one of "files" or "arxivId".');
      }

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
}
