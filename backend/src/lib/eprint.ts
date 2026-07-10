// Fetch a paper's PDF from IACR ePrint for the importer's PDF/LLM stage.
// ePrint serves only PDFs (no LaTeX source download exists — PLAN.md), which
// is exactly why the PDF pipeline exists: most crypto papers live primarily
// on ePrint.

/** Thrown for every anticipated failure; `code`/`statusCode` map onto sendError. */
export class EprintFetchError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EprintFetchError';
  }
}

/**
 * Decoded-PDF cap. Keeps base64 uploads under the scan route's 32 MB body
 * limit and bounds what we ship to the LLM; crypto papers are far smaller.
 */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 60_000;

export async function fetchEprintPdf(
  eprintId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(`https://eprint.iacr.org/${eprintId}.pdf`, {
      headers: { 'user-agent': 'crypto-wiki importer (mailto:kaptchuk@umd.edu)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch {
    throw new EprintFetchError(502, 'EPRINT_UNREACHABLE', 'Could not reach eprint.iacr.org.');
  }
  if (res.status === 404) {
    throw new EprintFetchError(404, 'EPRINT_NOT_FOUND', `ePrint has no paper "${eprintId}".`);
  }
  if (!res.ok) {
    throw new EprintFetchError(502, 'EPRINT_UNREACHABLE', `ePrint responded with HTTP ${res.status}.`);
  }
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new EprintFetchError(422, 'EPRINT_BAD_PAYLOAD', 'ePrint returned something that is not a PDF.');
  }
  if (pdf.length > MAX_PDF_BYTES) {
    throw new EprintFetchError(422, 'EPRINT_TOO_LARGE', 'The paper PDF is too large to import.');
  }
  return pdf;
}
