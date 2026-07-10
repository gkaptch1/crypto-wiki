import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedInject, makeApp, resetDb, signUp, type TestApp } from './helpers';
import { prisma } from '../src/lib/prisma';
import { resolveCitation, CitationFetchError } from '../src/lib/citation';

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

const ARXIV_BIB = `@misc{christ2024pseudorandom,
  title={Pseudorandom Error-Correcting Codes},
  author={Miranda Christ and Sam Gunn},
  year={2024},
  eprint={2402.09370},
  archivePrefix={arXiv},
  primaryClass={cs.CR},
}`;

const DBLP_BIB = `@inproceedings{DBLP:conf/crypto/GoelGHK22,
  author = {Aarushi Goel and Matthew Green and Mathias Hall{-}Andersen and Gabriel Kaptchuk},
  title = {Stacking Sigmas},
  booktitle = {{CRYPTO} 2022},
  year = {2022},
  doi = {10.1007/978-3-031-15985-5\\_16},
  url = {https://doi.org/10.1007/978-3-031-15985-5\\_16}
}`;

// The BibTeX ePrint embeds in the paper page (there is no .bib endpoint).
const EPRINT_PAGE_HTML = `<html><body><pre>@misc{cryptoeprint:2021/422,
      author = {Aarushi Goel and Matthew Green and Mathias Hall-Andersen and Gabriel Kaptchuk},
      title = {Stacking Sigmas: A Framework to Compose {$\\Sigma$}-Protocols for Disjunctions},
      howpublished = {Cryptology {ePrint} Archive, Paper 2021/422},
      year = {2021},
      url = {https://eprint.iacr.org/2021/422}
}</pre></body></html>`;

const stubText = (body: string, status = 200) =>
  (async () => new Response(body, { status })) as typeof fetch;

describe('resolveCitation (stubbed fetch)', () => {
  it('parses arXiv bibtex and defaults the abs URL', async () => {
    const r = await resolveCitation({ arxivId: '2402.09370' }, stubText(ARXIV_BIB));
    expect(r.source).toBe('arXiv:2402.09370');
    expect(r.citation).toMatchObject({
      paper: 'Pseudorandom Error-Correcting Codes',
      authors: 'Miranda Christ, Sam Gunn',
      year: 2024,
      url: 'https://arxiv.org/abs/2402.09370',
    });
    expect(r.citation.eprint).toBeUndefined(); // arXiv id is NOT an IACR ePrint id
  });

  it('parses DBLP bibtex with venue and doi', async () => {
    const r = await resolveCitation({ dblpKey: 'conf/crypto/GoelGHK22' }, stubText(DBLP_BIB));
    expect(r.source).toBe('DBLP conf/crypto/GoelGHK22');
    expect(r.citation).toMatchObject({
      venue: 'CRYPTO 2022',
      year: 2022,
      doi: '10.1007/978-3-031-15985-5_16',
    });
  });

  it('extracts the bibtex block from an ePrint page and defaults eprint/url', async () => {
    const r = await resolveCitation({ eprintId: '2021/422' }, stubText(EPRINT_PAGE_HTML));
    expect(r.source).toBe('ePrint 2021/422');
    expect(r.citation).toMatchObject({
      paper: 'Stacking Sigmas: A Framework to Compose Σ-Protocols for Disjunctions',
      eprint: '2021/422',
      url: 'https://eprint.iacr.org/2021/422',
    });
  });

  it('502s when the ePrint page carries no bibtex', async () => {
    await expect(
      resolveCitation({ eprintId: '2021/422' }, stubText('<html>no citation here</html>')),
    ).rejects.toMatchObject({ code: 'CITATION_NO_BIBTEX', statusCode: 502 });
  });

  it('parses pasted bibtex without any network', async () => {
    const throwing = (async () => {
      throw new Error('should not fetch');
    }) as typeof fetch;
    const r = await resolveCitation({ bibtex: ARXIV_BIB }, throwing);
    expect(r.source).toBe('pasted BibTeX');
    expect(r.citation.paper).toContain('Pseudorandom');
  });

  it('warns (not throws) when a source has no parseable entry', async () => {
    const r = await resolveCitation({ bibtex: 'just prose, no entry' }, stubText(''));
    expect(r.citation).toEqual({});
    expect(r.warnings).toHaveLength(1);
  });

  it('maps 404 and network failures onto codes sendError understands', async () => {
    await expect(
      resolveCitation({ arxivId: '1234.5678' }, stubText('nope', 404)),
    ).rejects.toMatchObject({ code: 'CITATION_NOT_FOUND', statusCode: 404 });
    const boom = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    await expect(
      resolveCitation({ arxivId: '1234.5678' }, boom),
    ).rejects.toMatchObject({ code: 'CITATION_UNREACHABLE', statusCode: 502 });
  });

  it('normalizes a DBLP URL to its .bib and rejects a malformed key', async () => {
    let requested = '';
    const spy = (async (u: unknown) => {
      requested = String(u);
      return new Response(DBLP_BIB);
    }) as typeof fetch;
    await resolveCitation({ dblpKey: 'https://dblp.org/rec/conf/crypto/GoelGHK22.html' }, spy);
    expect(requested).toBe('https://dblp.org/rec/conf/crypto/GoelGHK22.bib');
    await expect(
      resolveCitation({ dblpKey: 'not a key!' }, spy),
    ).rejects.toBeInstanceOf(CitationFetchError);
  });
});

describe('POST /import/citation — route', () => {
  it('401s signed-out and 403s viewers (editor surface)', async () => {
    const anon = await app.inject({ method: 'POST', url: '/import/citation', payload: { bibtex: ARXIV_BIB } });
    expect(anon.statusCode).toBe(401);
    const viewer = await viewerInject({ method: 'POST', url: '/import/citation', payload: { bibtex: ARXIV_BIB } });
    expect(viewer.statusCode).toBe(403);
  });

  it('400s on neither and on multiple inputs', async () => {
    for (const payload of [{}, { arxivId: '2402.09370', bibtex: ARXIV_BIB }]) {
      const res = await inject({ method: 'POST', url: '/import/citation', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('resolves pasted bibtex end to end (no network)', async () => {
    const res = await inject({ method: 'POST', url: '/import/citation', payload: { bibtex: ARXIV_BIB } });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe('pasted BibTeX');
    expect(res.json().citation.paper).toContain('Pseudorandom');
  });
});

describe('citeUrl persists through the formulation citation', () => {
  it('round-trips a paper URL onto the public wiki page', async () => {
    const created = await inject({
      method: 'POST',
      url: '/definitions',
      payload: {
        slug: 'sig-scheme',
        title: 'Signature Scheme',
        formulation: {
          slug: 'euf-cma',
          bodyLatex: '\\textbf{Definition.} A signature scheme is EUF-CMA secure if …',
          citation: { paper: 'PRCs', url: 'https://arxiv.org/abs/2402.09370', eprint: '2024/235' },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const draftId = created.json().formulations[0].revisions[0].id as number;
    const pub = await inject({
      method: 'POST',
      url: `/definitions/sig-scheme/formulations/euf-cma/revisions/${draftId}/publish`,
    });
    expect(pub.statusCode).toBe(200);

    const page = await app.inject({ method: 'GET', url: '/def/sig-scheme' });
    expect(page.statusCode).toBe(200);
    expect(page.json().formulation.citation.url).toBe('https://arxiv.org/abs/2402.09370');
    expect(page.json().formulation.citation.eprint).toBe('2024/235');
  });
});
