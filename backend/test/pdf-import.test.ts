import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { authedInject, makeApp, resetDb, signUp, type TestApp } from './helpers';
import { prisma } from '../src/lib/prisma';
import { EprintFetchError, fetchEprintPdf } from '../src/lib/eprint';
import { scoutPdf } from '../src/lib/pdf-scout';
import {
  buildSubPdf,
  buildSyntheticLatex,
  extractionToScanResult,
  guidedPages,
  llmExtractFromPdf,
  PdfImportError,
  textLayerAgreement,
  type LlmComplete,
  type PdfExtraction,
} from '../src/lib/pdf-extract';

// The route pulls the ePrint fetch + LLM call from these modules; mock the
// network/LLM edges, keep everything else (incl. the error classes) real.
vi.mock('../src/lib/eprint', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/eprint')>();
  return { ...real, fetchEprintPdf: vi.fn(real.fetchEprintPdf) };
});
vi.mock('../src/lib/pdf-extract', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/pdf-extract')>();
  return { ...real, llmExtractFromPdf: vi.fn(real.llmExtractFromPdf) };
});

/** Draw a tiny text-layer PDF: one string[] of lines per page. */
async function makePdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 720 - 20 * i, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}

const PAPER_PAGES: string[][] = [
  ['A Paper About PRFs', 'Some introductory prose mentioning the definition of security.'],
  ['Definition 3.1 (Pseudorandom Function).', 'A function F is pseudorandom if no adversary', 'distinguishes it from random.'],
  ['More prose in the middle.'],
  ['Construction 2', 'Let G be a PRG. Define F(k, x) as follows.'],
];

describe('scoutPdf (deterministic text layer)', () => {
  it('finds numbered definition-like headings with pages, skips bare prose keywords', async () => {
    const pdf = await makePdf(PAPER_PAGES);
    const scout = await scoutPdf(pdf);
    expect(scout.pageCount).toBe(4);
    expect(scout.candidates).toHaveLength(2);
    expect(scout.candidates[0]).toMatchObject({
      kind: 'Definition',
      number: '3.1',
      title: 'Pseudorandom Function',
      page: 2,
    });
    expect(scout.candidates[0].preview).toContain('pseudorandom');
    expect(scout.candidates[1]).toMatchObject({ kind: 'Construction', number: '2', page: 4 });
  });

  it('rejects non-PDF bytes', async () => {
    await expect(scoutPdf(Buffer.from('not a pdf'))).rejects.toThrow();
  });
});

describe('guided-mode page subsetting', () => {
  it('guidedPages: candidate pages + one page of spillover, deduped and clamped', () => {
    const scout = [
      { kind: 'Definition', number: '1', title: null, page: 2, preview: '' },
      { kind: 'Definition', number: '2', title: null, page: 3, preview: '' },
      { kind: 'Game', number: '1', title: null, page: 5, preview: '' },
    ];
    expect(guidedPages(scout, 5)).toEqual([2, 3, 4, 5]);
  });

  it('buildSubPdf keeps only the requested pages', async () => {
    const pdf = await makePdf(PAPER_PAGES);
    const sub = await buildSubPdf(pdf, [2, 4]);
    const scout = await scoutPdf(sub);
    expect(scout.pageCount).toBe(2);
    expect(scout.candidates.map((c) => c.kind)).toEqual(['Definition', 'Construction']);
  });
});

const EXTRACTION: PdfExtraction = {
  macros: ['\\newcommand{\\adv}{\\mathcal{A}}', '\\newcommand{\\prf}{\\mathsf{F}}'],
  candidates: [
    {
      envName: 'definition',
      displayName: 'Definition',
      title: 'Pseudorandom Function',
      body: 'A function $\\prf$ is pseudorandom if no $\\adv$ distinguishes it.',
      page: null,
      scoutIndex: 0,
    },
    {
      envName: 'construction',
      displayName: 'Construction',
      title: null,
      body: 'Let $G$ be a PRG. Define $\\prf(k, x)$ as follows.',
      page: 4,
      scoutIndex: null,
    },
  ],
  warnings: ['The construction body continues onto an unreadable figure.'],
};

const SCOUT = [
  {
    kind: 'Definition',
    number: '3.1',
    title: 'Pseudorandom Function',
    page: 2,
    // realistic text-layer preview: prose intact, math garbled (F, A bare)
    preview: 'A function F is pseudorandom if no adversary A distinguishes it from random.',
  },
  { kind: 'Game', number: '7', title: null, page: 9, preview: '' },
];

describe('extractionToScanResult (LLM JSON → deterministic validation)', () => {
  it('assembles a synthetic .tex the real extractor can parse', () => {
    const tex = buildSyntheticLatex(EXTRACTION);
    expect(tex).toContain('\\newtheorem{definition}{Definition}');
    expect(tex).toContain('\\newtheorem{construction}{Construction}');
    expect(tex).toContain('\\begin{definition}[Pseudorandom Function]');
  });

  it('parses macros + candidates and remaps provenance to pdf name + page', () => {
    const result = extractionToScanResult(EXTRACTION, 'eprint-2024-235.pdf', SCOUT);
    expect(result.macroMap).toHaveProperty('\\adv', '\\mathcal{A}');
    expect(result.candidates).toHaveLength(2);
    // scoutIndex 0 → page from the scout entry
    expect(result.candidates[0]).toMatchObject({
      envName: 'definition',
      title: 'Pseudorandom Function',
      file: 'eprint-2024-235.pdf',
      line: 2,
    });
    expect(result.candidates[0].usedMacros).toEqual(
      expect.arrayContaining(['\\adv', '\\prf']),
    );
    // no scoutIndex → the model-reported page
    expect(result.candidates[1]).toMatchObject({ file: 'eprint-2024-235.pdf', line: 4 });
    // LLM warnings pass through, prefixed
    expect(result.warnings.some((w) => w.startsWith('LLM: The construction body'))).toBe(true);
    // scout entry [1] (Game 7) not covered → cross-check warning
    expect(result.warnings.some((w) => w.includes('Game 7') && w.includes('page 9'))).toBe(true);
  });

  it('flags a candidate-count mismatch instead of misattributing pages', () => {
    // a body carrying its own nested definition env desyncs the counts: the
    // extractor (correctly) surfaces the nested one as an extra candidate
    const broken: PdfExtraction = {
      ...EXTRACTION,
      candidates: [
        {
          ...EXTRACTION.candidates[0],
          body: 'Outer. \\begin{definition} Inner. \\end{definition} Tail.',
        },
        EXTRACTION.candidates[1],
      ],
    };
    const result = extractionToScanResult(broken, 'x.pdf', []);
    expect(result.warnings.some((w) => w.includes('Review carefully'))).toBe(true);
  });
});

describe('text-layer agreement (deterministic reconstruction check)', () => {
  it('scores prose overlap, stripping LaTeX commands from the body', () => {
    const body = 'A function $\\prf$ is pseudorandom if no adversary distinguishes it from random.';
    const preview = 'A function F is pseudorandom if no adversary A distinguishes it from random.';
    expect(textLayerAgreement(body, preview)).toBeGreaterThan(0.8);
  });

  it('returns null when the preview has too little prose to judge', () => {
    expect(textLayerAgreement('anything at all', 'Enc ( x ) = y + 1')).toBeNull();
    expect(textLayerAgreement('anything', '')).toBeNull();
  });

  it('a matching reconstruction produces no divergence warning', () => {
    const result = extractionToScanResult(EXTRACTION, 'p.pdf', SCOUT);
    expect(result.warnings.some((w) => w.includes('shares only'))).toBe(false);
  });

  it('a reconstruction disjoint from the text layer near its heading warns', () => {
    const wrongBlock: PdfExtraction = {
      ...EXTRACTION,
      candidates: [
        {
          ...EXTRACTION.candidates[0],
          body: 'Completely unrelated sentence about lattices, trapdoors, and gaussian sampling procedures.',
        },
        EXTRACTION.candidates[1],
      ],
    };
    const result = extractionToScanResult(wrongBlock, 'p.pdf', SCOUT);
    const warning = result.warnings.find((w) => w.includes('shares only'));
    expect(warning).toBeDefined();
    expect(warning).toContain('Definition 3.1');
    expect(warning).toContain('page 2');
  });
});

describe('llmExtractFromPdf (injected completion)', () => {
  const fakeComplete = (json: string): LlmComplete =>
    vi.fn(async () => ({ json, inputTokens: 150_000, outputTokens: 20_000 }));

  it('full mode: whole pdf in, scan result + usage out', async () => {
    const pdf = await makePdf(PAPER_PAGES);
    const complete = fakeComplete(JSON.stringify(EXTRACTION));
    const result = await llmExtractFromPdf(pdf, { pdfName: 'paper.pdf', complete });
    expect(result.candidates).toHaveLength(2);
    expect(result.llm).toMatchObject({ mode: 'full', inputTokens: 150_000, outputTokens: 20_000 });
    // 150k × $5/M + 20k × $25/M = $0.75 + $0.50
    expect(result.llm.estimatedCostUsd).toBeCloseTo(1.25, 4);
    const arg = (complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.prompt).toContain('[0] Definition 3.1 (Pseudorandom Function) — page 2');
    // scout previews anchor the checklist entries
    expect(arg.prompt).toContain('text layer: "');
    expect(Buffer.from(arg.pdfBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
  });

  it('guided mode: ships only candidate pages (+spillover)', async () => {
    const pdf = await makePdf(PAPER_PAGES);
    const complete = fakeComplete(JSON.stringify(EXTRACTION));
    await llmExtractFromPdf(pdf, { pdfName: 'paper.pdf', mode: 'guided', complete });
    const arg = (complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const sub = await scoutPdf(Buffer.from(arg.pdfBase64, 'base64'));
    expect(sub.pageCount).toBe(3); // pages 2,3 (def+spill) and 4 (constr; 5 clamped)
  });

  it('guided mode with nothing scouted is a 422, not a silent full-pdf send', async () => {
    const blank = await makePdf([['Nothing formal here at all.']]);
    await expect(
      llmExtractFromPdf(blank, { pdfName: 'x.pdf', mode: 'guided', complete: fakeComplete('{}') }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'NO_CANDIDATE_PAGES' });
  });

  it('unparseable LLM output is a 502', async () => {
    const pdf = await makePdf(PAPER_PAGES);
    await expect(
      llmExtractFromPdf(pdf, { pdfName: 'x.pdf', complete: fakeComplete('not json') }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'LLM_BAD_OUTPUT' });
  });
});

describe('fetchEprintPdf (stubbed fetch)', () => {
  const pdfBytes = Buffer.from('%PDF-1.5 fake');
  it('fetches and validates a pdf', async () => {
    const stub = (async () => new Response(pdfBytes, { status: 200 })) as typeof fetch;
    await expect(fetchEprintPdf('2024/235', stub)).resolves.toEqual(pdfBytes);
  });
  it('404 → EPRINT_NOT_FOUND', async () => {
    const stub = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(fetchEprintPdf('2024/9999', stub)).rejects.toMatchObject({
      statusCode: 404,
      code: 'EPRINT_NOT_FOUND',
    });
  });
  it('non-pdf payload → EPRINT_BAD_PAYLOAD', async () => {
    const stub = (async () => new Response('<html>captcha</html>', { status: 200 })) as typeof fetch;
    await expect(fetchEprintPdf('2024/235', stub)).rejects.toMatchObject({
      statusCode: 422,
      code: 'EPRINT_BAD_PAYLOAD',
    });
  });
});

// ---------------------------------------------------------------------------
// route surface (mocked edges)

let app: TestApp;
let inject: TestApp['inject'];

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  inject = authedInject(app, (await signUp(app, { role: 'editor' })).cookie);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST /import/scan — PDF inputs', () => {
  const CANNED = {
    ...extractionToScanResult(EXTRACTION, 'eprint-2024-235.pdf', SCOUT),
    llm: {
      model: 'claude-opus-4-8',
      mode: 'full' as const,
      inputTokens: 1000,
      outputTokens: 100,
      estimatedCostUsd: 0.0075,
    },
  };

  it('rejects combined inputs (exactly one of files/arxivId/eprintId/pdfBase64)', async () => {
    for (const payload of [
      { eprintId: '2024/235', arxivId: '2402.09370' },
      { files: { 'a.tex': 'x' }, pdfBase64: 'JVBERg==' },
      {},
    ]) {
      const res = await inject({ method: 'POST', url: '/import/scan', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('rejects a malformed eprint id via schema', async () => {
    const res = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { eprintId: 'not-an-id' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an upload that is not a PDF', async () => {
    const res = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { pdfBase64: Buffer.from('hello').toString('base64') },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('BAD_PDF');
  });

  it('eprintId path: fetches the pdf, runs the LLM stage, serializes llm usage', async () => {
    vi.mocked(fetchEprintPdf).mockResolvedValueOnce(Buffer.from('%PDF-1.5 fake'));
    vi.mocked(llmExtractFromPdf).mockResolvedValueOnce(CANNED);
    const res = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { eprintId: '2024/235', pdfMode: 'full' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toHaveLength(2);
    expect(body.llm).toMatchObject({ model: 'claude-opus-4-8', mode: 'full' });
    expect(vi.mocked(llmExtractFromPdf).mock.lastCall?.[1]).toMatchObject({
      pdfName: 'eprint-2024-235.pdf',
      mode: 'full',
    });
  });

  it('surfaces EprintFetchError with its status/code', async () => {
    vi.mocked(fetchEprintPdf).mockRejectedValueOnce(
      new EprintFetchError(404, 'EPRINT_NOT_FOUND', 'ePrint has no paper "2024/9999".'),
    );
    const res = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { eprintId: '2024/9999' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('EPRINT_NOT_FOUND');
  });

  it('surfaces LLM_NOT_CONFIGURED as a 503', async () => {
    vi.mocked(llmExtractFromPdf).mockRejectedValueOnce(
      new PdfImportError(503, 'LLM_NOT_CONFIGURED', 'PDF import needs Anthropic API credentials.'),
    );
    const res = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { pdfBase64: Buffer.from('%PDF-1.5 fake').toString('base64'), pdfName: 'p.pdf' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('LLM_NOT_CONFIGURED');
  });
});
