import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedInject, makeApp, resetDb, signUp, type TestApp } from './helpers';
import { prisma } from '../src/lib/prisma';
import { ArxivFetchError, decodeArxivPayload, fetchArxivSource } from '../src/lib/arxiv';

let app: TestApp;
let inject: TestApp['inject'];
let viewerInject: TestApp['inject'];

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  inject = authedInject(app, (await signUp(app, { role: 'editor' })).cookie);
  viewerInject = authedInject(app, (await signUp(app, { role: 'viewer' })).cookie);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// a two-file mini paper: macros in their own file, one definition env
// instance, one standalone \procedure game box
const PAPER = {
  'main.tex': [
    '\\documentclass{article}',
    '\\usepackage{amsthm}',
    '\\input{macros}',
    '\\newtheorem{definition}{Definition}',
    '\\begin{document}',
    '\\begin{definition}[Pseudorandom Function]\\label{def:prf}',
    'A function $\\prf$ is pseudorandom if no $\\adv$ distinguishes it.',
    '\\end{definition}',
    '\\procedure{$\\mathsf{Exp}^{\\text{ind}}$}{b \\sample \\bin \\\\ \\pcreturn b}',
    '\\end{document}',
  ].join('\n'),
  'macros.tex': [
    '\\newcommand{\\adv}{\\mathcal{A}}',
    '\\newcommand{\\prf}{\\mathsf{F}}',
    '\\newcommand{\\unused}{u}',
  ].join('\n'),
};

describe('POST /import/scan — auth', () => {
  it('401s signed-out and 403s viewers (editor surface)', async () => {
    const anon = await app.inject({ method: 'POST', url: '/import/scan', payload: { files: PAPER } });
    expect(anon.statusCode).toBe(401);
    const viewer = await viewerInject({ method: 'POST', url: '/import/scan', payload: { files: PAPER } });
    expect(viewer.statusCode).toBe(403);
  });
});

describe('POST /import/scan — files input', () => {
  it('extracts candidates, macros, and per-candidate usedMacros slices', async () => {
    const res = await inject({ method: 'POST', url: '/import/scan', payload: { files: PAPER } });
    expect(res.statusCode).toBe(200);
    const scan = res.json();

    expect(scan.scannedFiles).toEqual(['main.tex', 'macros.tex']);
    expect(scan.macroMap).toMatchObject({ '\\adv': '\\mathcal{A}', '\\prf': '\\mathsf{F}' });
    expect(scan.theoremEnvs).toContainEqual(
      expect.objectContaining({ envName: 'definition', extracted: true }),
    );

    expect(scan.candidates).toHaveLength(2);
    const [def, proc] = scan.candidates;
    expect(def).toMatchObject({
      kind: 'theorem-env',
      envName: 'definition',
      title: 'Pseudorandom Function',
      label: 'def:prf',
      file: 'main.tex',
    });
    // the slice: macros the body actually uses, not the whole preamble
    expect(def.usedMacros.sort()).toEqual(['\\adv', '\\prf']);
    expect(proc.kind).toBe('procedure');
  });

  it('honors mainFile and 400s when it is not among the files', async () => {
    const ok = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { files: PAPER, mainFile: 'main.tex' },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { files: PAPER, mainFile: 'nope.tex' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('BAD_INPUT');
  });

  it('400s on neither/both inputs and on an empty files map', async () => {
    for (const payload of [{}, { files: PAPER, arxivId: '2402.09370' }, { files: {} }]) {
      const res = await inject({ method: 'POST', url: '/import/scan', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('BAD_INPUT');
    }
  });

  it('rejects a malformed arXiv id at the schema layer', async () => {
    const res = await inject({
      method: 'POST',
      url: '/import/scan',
      payload: { arxivId: 'not-an-id!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION');
  });
});

describe('arXiv payload decoding (no network)', () => {
  it('rejects PDF-only payloads with ARXIV_NO_SOURCE', () => {
    expect(() => decodeArxivPayload(Buffer.from('%PDF-1.5 …'), '1234.5678')).toThrowError(
      expect.objectContaining({ code: 'ARXIV_NO_SOURCE', statusCode: 422 }),
    );
  });

  it('rejects unrecognized and corrupt payloads', () => {
    expect(() => decodeArxivPayload(Buffer.from('hello'), 'x')).toThrowError(
      expect.objectContaining({ code: 'ARXIV_BAD_PAYLOAD' }),
    );
    const corrupt = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('junk')]);
    expect(() => decodeArxivPayload(corrupt, 'x')).toThrowError(
      expect.objectContaining({ code: 'ARXIV_BAD_PAYLOAD' }),
    );
  });

  it('decodes a single gzipped .tex as main.tex', () => {
    const files = decodeArxivPayload(gzipSync(Buffer.from(PAPER['main.tex'])), 'x');
    expect(Object.keys(files)).toEqual(['main.tex']);
    expect(files['main.tex']).toContain('\\documentclass');
  });

  it('decodes a gzipped tarball, keeping only text files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxiv-test-'));
    try {
      fs.writeFileSync(path.join(dir, 'main.tex'), PAPER['main.tex']);
      fs.mkdirSync(path.join(dir, 'sections'));
      fs.writeFileSync(path.join(dir, 'sections', 'macros.tex'), PAPER['macros.tex']);
      fs.writeFileSync(path.join(dir, 'figure.pdf'), '%PDF-1.5 binary stuff');
      const tarball = path.join(dir, 'paper.tar.gz');
      execFileSync('tar', ['czf', tarball, '-C', dir, 'main.tex', 'sections', 'figure.pdf']);

      const files = decodeArxivPayload(fs.readFileSync(tarball), 'x');
      expect(Object.keys(files).sort()).toEqual(['main.tex', 'sections/macros.tex']);
      expect(files['sections/macros.tex']).toContain('\\newcommand{\\adv}');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors when a tarball ships no text files at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxiv-test-'));
    try {
      fs.writeFileSync(path.join(dir, 'figure.pdf'), '%PDF-1.5');
      const tarball = path.join(dir, 'paper.tar.gz');
      execFileSync('tar', ['czf', tarball, '-C', dir, 'figure.pdf']);
      expect(() => decodeArxivPayload(fs.readFileSync(tarball), 'x')).toThrowError(
        expect.objectContaining({ code: 'ARXIV_NO_TEX' }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fetchArxivSource (stubbed fetch)', () => {
  it('maps a 404 to ARXIV_NOT_FOUND', async () => {
    const stub = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    await expect(fetchArxivSource('1234.5678', stub)).rejects.toMatchObject({
      code: 'ARXIV_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('maps network failure to ARXIV_UNREACHABLE', async () => {
    const stub = (async () => {
      throw new Error('boom');
    }) as typeof fetch;
    await expect(fetchArxivSource('1234.5678', stub)).rejects.toMatchObject({
      code: 'ARXIV_UNREACHABLE',
      statusCode: 502,
    });
  });

  it('returns decoded files on success', async () => {
    const payload = gzipSync(Buffer.from(PAPER['main.tex']));
    const stub = (async () => new Response(new Uint8Array(payload), { status: 200 })) as typeof fetch;
    await expect(fetchArxivSource('1234.5678', stub)).resolves.toHaveProperty('main.tex');
  });

  it('exposes ArxivFetchError with the pieces sendError needs', () => {
    const err = new ArxivFetchError(422, 'ARXIV_NO_SOURCE', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(422);
  });
});
