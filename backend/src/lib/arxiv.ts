import { gunzipSync } from 'node:zlib';

// Fetch a paper's LaTeX source from arXiv for the importer's fetch-by-id
// convenience path (the primary input is pasted/uploaded .tex — ePrint has
// no source download at all, see PLAN.md). arXiv's e-print endpoint serves
// either a gzipped tar (multi-file), a single gzipped .tex, or — when the
// author never uploaded source — a bare PDF, which we surface as a distinct
// error so the UI can point at the paste-your-own-.tex path.

/** Thrown for every anticipated failure; `code`/`statusCode` map onto sendError. */
export class ArxivFetchError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArxivFetchError';
  }
}

/** Decompressed payloads larger than this are rejected (gzip-bomb guard). */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
/** Per-file cap, matching ImportScanBody's per-file maxLength. */
const MAX_FILE_BYTES = 5_000_000;
/** Extensions the extractor can do anything with (roots, \input, \usepackage). */
const TEXT_EXTENSIONS = /\.(tex|sty|cls|ltx|clo|def|bbl)$/i;

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchArxivSource(
  arxivId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  let res: Response;
  try {
    res = await fetchImpl(`https://arxiv.org/e-print/${arxivId}`, {
      headers: { 'user-agent': 'crypto-wiki importer (mailto:kaptchuk@umd.edu)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch {
    throw new ArxivFetchError(502, 'ARXIV_UNREACHABLE', 'Could not reach arxiv.org.');
  }
  if (res.status === 404) {
    throw new ArxivFetchError(404, 'ARXIV_NOT_FOUND', `arXiv has no paper "${arxivId}".`);
  }
  if (!res.ok) {
    throw new ArxivFetchError(502, 'ARXIV_UNREACHABLE', `arXiv responded with HTTP ${res.status}.`);
  }
  return decodeArxivPayload(Buffer.from(await res.arrayBuffer()), arxivId);
}

/** Exported separately so tests can exercise the decoding without the network. */
export function decodeArxivPayload(payload: Buffer, arxivId: string): Record<string, string> {
  if (payload.subarray(0, 4).toString('latin1') === '%PDF') {
    throw new ArxivFetchError(
      422,
      'ARXIV_NO_SOURCE',
      `arXiv only has a PDF for "${arxivId}" (the author never uploaded LaTeX source). ` +
        'Paste or upload the .tex instead.',
    );
  }
  if (payload[0] !== 0x1f || payload[1] !== 0x8b) {
    throw new ArxivFetchError(422, 'ARXIV_BAD_PAYLOAD', 'arXiv returned an unrecognized payload.');
  }

  let unpacked: Buffer;
  try {
    unpacked = gunzipSync(payload, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ArxivFetchError(422, 'ARXIV_TOO_LARGE', 'The paper source is too large to import.');
    }
    throw new ArxivFetchError(422, 'ARXIV_BAD_PAYLOAD', 'arXiv returned a corrupt gzip payload.');
  }

  // tarball vs. single gzipped .tex: ustar magic sits at offset 257
  const files =
    unpacked.subarray(257, 262).toString('latin1') === 'ustar'
      ? untarTextFiles(unpacked)
      : { 'main.tex': unpacked.toString('utf8') };

  if (Object.keys(files).length === 0) {
    throw new ArxivFetchError(
      422,
      'ARXIV_NO_TEX',
      `The source for "${arxivId}" contains no .tex files.`,
    );
  }
  return files;
}

/**
 * Minimal ustar reader — regular text files only. Handles GNU long names
 * (type L) and skips pax headers (x/g), directories, and binary assets;
 * arXiv tarballs are flat enough that this covers them.
 */
function untarTextFiles(tar: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let offset = 0;
  let longName: string | null = null;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive marker

    const sizeField = header.subarray(124, 136).toString('latin1').replace(/[^0-7]/g, '');
    const size = sizeField ? parseInt(sizeField, 8) : 0;
    if (!Number.isFinite(size) || size < 0) break; // corrupt header — stop, keep what we have
    const typeflag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);

    if (typeflag === 'L') {
      // GNU long-name entry: its data is the name of the NEXT entry
      longName = data.toString('utf8').replace(/\0+$/, '');
    } else if (typeflag === '0' || typeflag === '\0') {
      let name = longName ?? header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
      const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '');
      if (!longName && prefix) name = `${prefix}/${name}`;
      longName = null;
      name = name.replace(/^\.\//, '');
      // (^|/)\._ skips AppleDouble metadata — Mac-built tarballs do reach arXiv
      if (
        TEXT_EXTENSIONS.test(name) &&
        size <= MAX_FILE_BYTES &&
        !name.includes('..') &&
        !/(^|\/)\._/.test(name)
      ) {
        files[name] = data.toString('utf8');
      }
    } else {
      longName = null; // pax headers, dirs, links: skip data, drop any stale long name
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}
