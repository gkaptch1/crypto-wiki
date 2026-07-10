// LLM stage of the paper importer (PLAN.md Phase 3): reconstruct definition-
// like blocks + notation macros from a PDF. The LLM's only irreducible job is
// LaTeX reconstruction — everything around it is deterministic:
//
//   scoutPdf (text layer, free)  →  checklist + candidate pages
//   Claude (JSON-schema-forced)  →  { macros[], candidates[], warnings[] }
//   buildSyntheticLatex          →  a synthetic .tex assembled from that JSON
//   extractFromLatex             →  the SAME ImportScanResult the /import
//                                   select step already consumes
//
// Running the LLM's output through the deterministic extractor is the
// validation harness PLAN.md calls for: malformed macro declarations get
// `issue` flags instead of vanishing, and scout entries the LLM failed to
// cover surface as warnings. Nothing is created by scanning; everything
// downstream (role gates, drafts-only, sealed locals) is unchanged.
//
// Modes: 'full' sends the whole PDF (baseline — learn the failure modes);
// 'guided' uses pdf-lib to send only the scout's candidate pages (+1 page of
// spillover each), the big token saver on long papers.

import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { extractFromLatex, type LatexImportResult } from '@crypto-wiki/shared';
import { scoutPdf, type ScoutCandidate } from './pdf-scout';

/** Thrown for every anticipated failure; `code`/`statusCode` map onto sendError. */
export class PdfImportError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PdfImportError';
  }
}

export type PdfScanMode = 'full' | 'guided';

export interface LlmUsage {
  model: string;
  mode: PdfScanMode;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export type PdfScanResult = LatexImportResult & { llm: LlmUsage };

/** What the JSON schema forces the model to return. */
export interface PdfExtraction {
  macros: string[];
  candidates: Array<{
    envName: string;
    displayName: string;
    title: string | null;
    body: string;
    page: number | null;
    scoutIndex: number | null;
  }>;
  warnings: string[];
}

// Validated 2026-07-10 against the 2402.09370 arXiv-source ground truth:
// guided+haiku reconstructed 27/27 numbered blocks with faithful bodies and
// 100% katexSafe macros at ~$0.12/paper (PLAN.md "PDF-stage validation").
const DEFAULT_MODEL = process.env.IMPORT_LLM_MODEL || 'claude-haiku-4-5';

/** $/MTok input, output — for the estimate we surface per scan. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

const ENV_NAMES = ['definition', 'experiment', 'construction', 'game', 'functionality'] as const;

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['macros', 'candidates', 'warnings'],
  properties: {
    macros: {
      type: 'array',
      items: {
        type: 'string',
        description:
          'One complete LaTeX macro declaration, e.g. "\\newcommand{\\adv}{\\mathcal{A}}"',
      },
    },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['envName', 'displayName', 'title', 'body', 'page', 'scoutIndex'],
        properties: {
          envName: { type: 'string', enum: [...ENV_NAMES] },
          displayName: { type: 'string' },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          body: { type: 'string' },
          page: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          scoutIndex: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} satisfies Record<string, unknown>;

const SYSTEM_PROMPT =
  'You are the paper-import extraction engine for a wiki of formal cryptographic ' +
  'definitions. Given a research paper PDF you reconstruct its formally stated ' +
  'definition-like blocks as faithful, compilable LaTeX, exactly as typeset — ' +
  'same wording, same notation, same math. You never paraphrase, never "fix" the ' +
  'paper, and never invent content that is not on the page.';

function buildChecklist(scout: ScoutCandidate[]): string {
  if (scout.length === 0) {
    return 'A deterministic text scan found no candidate headings; rely on your own reading.';
  }
  const lines = scout.map((c, i) => {
    const head = `[${i}] ${c.kind}${c.number ? ` ${c.number}` : ''}${
      c.title ? ` (${c.title})` : ''
    } — page ${c.page}`;
    return c.preview ? `${head}\n    text layer: "${c.preview}"` : head;
  });
  return (
    'A deterministic text scan of the paper found these candidate blocks. Cover every ' +
    'entry (set its index as scoutIndex on the matching candidate) and add any ' +
    'definition-like blocks it missed (scoutIndex null). If an entry is a false ' +
    'positive (not actually a formal block), skip it and say so in warnings. ' +
    'Entries may carry a "text layer:" snippet extracted from the PDF — its math is ' +
    'flattened and garbled (superscripts lost, script letters mangled), so use it ONLY ' +
    'to locate and match the block, never as the source of your reconstruction: ' +
    'reconstruct from the typeset page.\n' +
    lines.join('\n')
  );
}

// --- text-layer agreement: a zero-token post-check of the reconstruction ----

/** Prose words (≥4 letters) — math garble in the text layer mostly falls below this. */
const WORD_RE = /[a-zA-Z]{4,}/g;

function proseWords(s: string): Set<string> {
  return new Set((s.match(WORD_RE) ?? []).map((w) => w.toLowerCase()));
}

/**
 * Fraction of the scout preview's prose words that reappear in the
 * reconstructed body (LaTeX commands stripped first — a macro like \adv hides
 * the word "adversary", which is why the threshold below is lenient). Returns
 * null when the preview has too little prose to be a signal.
 */
export function textLayerAgreement(bodyLatex: string, preview: string): number | null {
  const previewWords = proseWords(preview);
  if (previewWords.size < 6) return null;
  const bodyWords = proseWords(bodyLatex.replace(/\\[a-zA-Z]+/g, ' '));
  let hits = 0;
  for (const w of previewWords) if (bodyWords.has(w)) hits++;
  return hits / previewWords.size;
}

/** Below this, warn that the reconstruction diverges from the text layer. */
const AGREEMENT_THRESHOLD = 0.4;

function buildPrompt(scout: ScoutCandidate[], mode: PdfScanMode): string {
  return [
    'Extract every formally stated, definition-like block from this paper: numbered ' +
      'theorem-style environments of kind definition, experiment, construction, game, or ' +
      'functionality. Do NOT include theorems, lemmas, corollaries, proofs, remarks, or ' +
      'definitions stated only in running prose.',
    '',
    'For each block return:',
    '- envName: the closest kind among definition | experiment | construction | game | functionality',
    '- displayName: the label as printed ("Definition", "Experiment", ...)',
    '- title: the parenthesized heading if present (e.g. "IND-CPA security"), else null',
    '- body: the body reconstructed as LaTeX, exactly as typeset. Reconstruct boxed ' +
      "game/oracle pseudocode with the cryptocode package's \\procedure{header}{...} syntax " +
      '(rows separated by \\\\, \\pcreturn, \\sample, \\pcfor, ...) when it appears inside a block. ' +
      'Do not include the "Definition N." heading itself in the body.',
    mode === 'guided'
      ? '- page: this PDF contains only selected pages of the paper; set page to the page ' +
        'number printed on the sheet if visible, else null (the checklist page + scoutIndex ' +
        'will be used instead).'
      : '- page: the 1-based page of this PDF where the block starts',
    '- scoutIndex: the matching checklist index below, else null',
    '',
    'Notation macros:',
    '- Carry the paper\'s notation through as LaTeX macros: when the paper repeatedly uses a ' +
      'semantic symbol (an adversary \\mathcal{A}, a named algorithm \\mathsf{Enc}, ...), emit a ' +
      'declaration for it in `macros` (a complete declaration string such as ' +
      '"\\newcommand{\\adv}{\\mathcal{A}}") and use that macro in the bodies.',
    '- Every non-standard command used in any body MUST have a declaration in `macros`; bodies ' +
      'must compile against standard LaTeX + amsmath + cryptocode + your declarations.',
    '- Declarations must be plain textual substitutions compatible with KaTeX: \\newcommand or ' +
      '\\DeclareMathOperator, optional numbered arguments #1..#9. No \\def, no conditionals.',
    '',
    'Return `warnings` for anything you could not read confidently: blurry or ambiguous math, ' +
      'blocks continuing past a visible page boundary, checklist entries you could not find.',
    '',
    buildChecklist(scout),
  ].join('\n');
}

/**
 * Copy only `pages` (1-based, sorted, deduped by caller) into a fresh PDF.
 * Guided mode's token saver.
 */
export async function buildSubPdf(pdf: Buffer, pages: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  return Buffer.from(await out.save());
}

/** Candidate pages plus one page of spillover each (blocks cross page breaks). */
export function guidedPages(scout: ScoutCandidate[], pageCount: number): number[] {
  const set = new Set<number>();
  for (const c of scout) {
    set.add(c.page);
    if (c.page + 1 <= pageCount) set.add(c.page + 1);
  }
  return [...set].sort((a, b) => a - b);
}

/** Escape a title for use inside `\begin{env}[...]` (matchBracket is brace-aware). */
function escapeTitle(title: string): string {
  return title.replace(/\]/g, '{]}');
}

/**
 * Assemble the synthetic .tex the deterministic extractor validates. One
 * candidate per env instance, in the LLM's order — extraction returns them in
 * document order, so index n here is candidate n there.
 */
export function buildSyntheticLatex(extraction: PdfExtraction): string {
  const envs = new Map<string, string>();
  for (const c of extraction.candidates) {
    const env = ENV_NAMES.includes(c.envName as (typeof ENV_NAMES)[number])
      ? c.envName
      : 'definition';
    if (!envs.has(env)) envs.set(env, c.displayName.trim() || env);
  }
  const lines: string[] = ['\\documentclass{article}', '\\usepackage{amsthm}'];
  for (const [env, display] of envs) lines.push(`\\newtheorem{${env}}{${display}}`);
  lines.push(...extraction.macros);
  lines.push('\\begin{document}');
  for (const c of extraction.candidates) {
    const env = ENV_NAMES.includes(c.envName as (typeof ENV_NAMES)[number])
      ? c.envName
      : 'definition';
    const opt = c.title !== null && c.title.trim() !== '' ? `[${escapeTitle(c.title.trim())}]` : '';
    lines.push(`\\begin{${env}}${opt}`, c.body.trim(), `\\end{${env}}`);
  }
  lines.push('\\end{document}');
  return lines.join('\n');
}

/**
 * Deterministic validation + normalization of the LLM's JSON: assemble the
 * synthetic .tex, run the real extractor over it, then remap provenance to
 * the PDF (file = pdf name, line = 1-based page). Pure — fully unit-testable.
 */
export function extractionToScanResult(
  extraction: PdfExtraction,
  pdfName: string,
  scout: ScoutCandidate[],
): LatexImportResult {
  const synthetic = buildSyntheticLatex(extraction);
  const envNames = [...new Set(extraction.candidates.map((c) => c.envName))];
  const result = extractFromLatex(
    { [pdfName + '.tex']: synthetic },
    envNames.length > 0 ? { environments: envNames } : {},
  );

  result.warnings.push(...extraction.warnings.map((w) => `LLM: ${w}`));

  // remap provenance: synthetic file:line → pdf name + page
  if (result.candidates.length === extraction.candidates.length) {
    result.candidates.forEach((candidate, i) => {
      const source = extraction.candidates[i];
      const scouted = source.scoutIndex !== null ? scout[source.scoutIndex] : undefined;
      candidate.file = pdfName;
      candidate.line = scouted?.page ?? source.page ?? 0;
    });
  } else {
    result.warnings.push(
      `The LLM returned ${extraction.candidates.length} block(s) but the extractor parsed ` +
        `${result.candidates.length} — a body likely contains a stray \\end{...}; page ` +
        'provenance was left off. Review carefully.',
    );
    for (const candidate of result.candidates) {
      candidate.file = pdfName;
      candidate.line = 0;
    }
  }

  // text-layer agreement: the preview near a heading is garbled math but
  // honest prose — a reconstruction that shares little prose with it likely
  // reconstructed the wrong block (or hallucinated)
  for (const c of extraction.candidates) {
    const scouted = c.scoutIndex !== null ? scout[c.scoutIndex] : undefined;
    if (!scouted) continue;
    const agreement = textLayerAgreement(c.body, scouted.preview);
    if (agreement !== null && agreement < AGREEMENT_THRESHOLD) {
      result.warnings.push(
        `Reconstructed "${scouted.kind}${scouted.number ? ` ${scouted.number}` : ''}${
          scouted.title ? ` (${scouted.title})` : ''
        }" shares only ${Math.round(agreement * 100)}% of its prose with the PDF text ` +
          `layer near its heading (page ${scouted.page}) — check the reconstruction.`,
      );
    }
  }

  // cross-check: every scout entry should be covered or explained
  const covered = new Set(
    extraction.candidates.map((c) => c.scoutIndex).filter((i): i is number => i !== null),
  );
  scout.forEach((s, i) => {
    if (!covered.has(i)) {
      result.warnings.push(
        `Text scan found "${s.kind}${s.number ? ` ${s.number}` : ''}${
          s.title ? ` (${s.title})` : ''
        }" on page ${s.page}, which the LLM did not return — false positive or a miss.`,
      );
    }
  });

  return result;
}

export function parseExtraction(json: string): PdfExtraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new PdfImportError(502, 'LLM_BAD_OUTPUT', 'The LLM returned unparseable JSON.');
  }
  const e = parsed as PdfExtraction;
  if (
    !e ||
    !Array.isArray(e.macros) ||
    !Array.isArray(e.candidates) ||
    !Array.isArray(e.warnings)
  ) {
    throw new PdfImportError(502, 'LLM_BAD_OUTPUT', 'The LLM returned an unexpected shape.');
  }
  return e;
}

/** The one thing tests inject: PDF + prompts in, JSON text + usage out. */
export type LlmComplete = (args: {
  pdfBase64: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
}) => Promise<{ json: string; inputTokens: number; outputTokens: number }>;

/**
 * Pre-4.6 models (Haiku 4.5, Sonnet 4.5, Opus ≤4.5) reject
 * `thinking: {type: 'adaptive'}` with a 400 — omit the param there and the
 * request runs without thinking, which is fine for a transcription task.
 */
function supportsAdaptiveThinking(model: string): boolean {
  return !/haiku|sonnet-4-5|opus-4-[015]/.test(model);
}

const anthropicComplete: LlmComplete = async ({ pdfBase64, system, prompt, schema, model }) => {
  let client: Anthropic;
  try {
    // zero-arg: resolves ANTHROPIC_API_KEY or an `ant auth login` profile
    client = new Anthropic();
  } catch {
    throw new PdfImportError(
      503,
      'LLM_NOT_CONFIGURED',
      'PDF import needs Anthropic API credentials: set ANTHROPIC_API_KEY in backend/.env (or `ant auth login`).',
    );
  }
  let message: Anthropic.Message;
  try {
    // stream to dodge HTTP timeouts — a long paper is minutes of output
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      ...(supportsAdaptiveThinking(model) ? { thinking: { type: 'adaptive' as const } } : {}),
      output_config: { format: { type: 'json_schema', schema } },
      system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new PdfImportError(
        503,
        'LLM_NOT_CONFIGURED',
        'Anthropic API credentials were rejected — check ANTHROPIC_API_KEY in backend/.env.',
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new PdfImportError(502, 'LLM_ERROR', `The LLM request failed: ${err.message}`);
    }
    throw err;
  }
  if (message.stop_reason === 'refusal') {
    throw new PdfImportError(502, 'LLM_REFUSED', 'The LLM declined to process this PDF.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new PdfImportError(
      502,
      'LLM_TRUNCATED',
      'The extraction exceeded the output limit — try guided mode, or import the paper in parts.',
    );
  }
  const text = message.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    throw new PdfImportError(502, 'LLM_BAD_OUTPUT', 'The LLM returned no text output.');
  }
  return {
    json: text.text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
};

export interface PdfExtractOptions {
  pdfName: string;
  mode?: PdfScanMode;
  model?: string;
  /** Test seam; defaults to the real Anthropic call. */
  complete?: LlmComplete;
}

export async function llmExtractFromPdf(
  pdf: Buffer,
  opts: PdfExtractOptions,
): Promise<PdfScanResult> {
  const mode: PdfScanMode = opts.mode ?? 'full';
  const model = opts.model ?? DEFAULT_MODEL;
  const complete = opts.complete ?? anthropicComplete;

  let scout;
  try {
    scout = await scoutPdf(pdf);
  } catch {
    throw new PdfImportError(422, 'BAD_PDF', 'Could not read that PDF.');
  }

  let payload = pdf;
  if (mode === 'guided') {
    if (scout.candidates.length === 0) {
      throw new PdfImportError(
        422,
        'NO_CANDIDATE_PAGES',
        'The text scan found no definition-like headings to guide a page subset — use full mode.',
      );
    }
    payload = await buildSubPdf(pdf, guidedPages(scout.candidates, scout.pageCount));
  }

  const { json, inputTokens, outputTokens } = await complete({
    pdfBase64: payload.toString('base64'),
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(scout.candidates, mode),
    schema: EXTRACTION_SCHEMA,
    model,
  });

  const extraction = parseExtraction(json);
  const result = extractionToScanResult(extraction, opts.pdfName, scout.candidates);
  const price = PRICES[model] ?? PRICES['claude-opus-4-8'];
  return {
    ...result,
    llm: {
      model,
      mode,
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        Math.round((inputTokens * price.in + outputTokens * price.out) / 100) / 10_000,
    },
  };
}
