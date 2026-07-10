import { describe, expect, it } from 'vitest';
import { parseBibtex, cleanLatex, normalizeAuthors } from '../src/bibtex.js';

describe('cleanLatex', () => {
  it('decodes accents and special letters', () => {
    expect(cleanLatex('H\\"ulsing')).toBe('Hülsing');
    expect(cleanLatex("Sch\\'{o}ning")).toBe('Schóning');
    expect(cleanLatex('\\"Ozbay')).toBe('Özbay');
    expect(cleanLatex('Hall-Andersen \\& Kaptchuk')).toBe('Hall-Andersen & Kaptchuk');
    expect(cleanLatex('\\v{S}tefan')).toBe('Štefan');
  });

  it('strips protective braces, ties, and stray commands', () => {
    expect(cleanLatex('{{Stacking Sigmas}}')).toBe('Stacking Sigmas');
    expect(cleanLatex('Compose~{$\\Sigma$}-Protocols')).toBe('Compose Σ-Protocols');
    expect(cleanLatex('\\emph{Pseudorandom} Codes')).toBe('Pseudorandom Codes');
  });
});

describe('normalizeAuthors', () => {
  it('flips "Last, First" and joins on "and"', () => {
    expect(normalizeAuthors('Christ, Miranda and Gunn, Sam')).toBe('Miranda Christ, Sam Gunn');
  });

  it('keeps already-natural names and drops DBLP disambiguators', () => {
    expect(normalizeAuthors('Miranda Christ and Sam Gunn')).toBe('Miranda Christ, Sam Gunn');
    expect(normalizeAuthors('Yael Tauman Kalai 0001')).toBe('Yael Tauman Kalai');
  });
});

describe('parseBibtex', () => {
  it('returns null when there is no entry', () => {
    expect(parseBibtex('not bibtex at all')).toBeNull();
    expect(parseBibtex('@comment{ignored}')).toBeNull();
  });

  it('parses an arXiv entry: title/authors/year/url, no IACR eprint', () => {
    const bib = `@misc{christ2024pseudorandom,
      title={Pseudorandom Error-Correcting Codes},
      author={Miranda Christ and Sam Gunn},
      year={2024},
      eprint={2402.09370},
      archivePrefix={arXiv},
      primaryClass={cs.CR},
      url={https://arxiv.org/abs/2402.09370},
    }`;
    expect(parseBibtex(bib)).toEqual({
      paper: 'Pseudorandom Error-Correcting Codes',
      authors: 'Miranda Christ, Sam Gunn',
      year: 2024,
      url: 'https://arxiv.org/abs/2402.09370',
    });
  });

  it('derives the arXiv URL from the id when no url field is present', () => {
    const bib = `@article{x, title={T}, author={A B}, eprint={2402.09370}, archivePrefix={arXiv}}`;
    expect(parseBibtex(bib)?.url).toBe('https://arxiv.org/abs/2402.09370');
  });

  it('recovers the IACR ePrint id from an ePrint entry', () => {
    const bib = `@misc{cryptoeprint:2021/422,
      author = {Aarushi Goel and Matthew Green and Mathias Hall-Andersen and Gabriel Kaptchuk},
      title = {Stacking Sigmas: A Framework to Compose {$\\Sigma$}-Protocols for Disjunctions},
      howpublished = {Cryptology {ePrint} Archive, Paper 2021/422},
      year = {2021},
      note = {\\url{https://eprint.iacr.org/2021/422}},
      url = {https://eprint.iacr.org/2021/422}
    }`;
    const c = parseBibtex(bib);
    expect(c).toMatchObject({
      paper: 'Stacking Sigmas: A Framework to Compose Σ-Protocols for Disjunctions',
      authors: 'Aarushi Goel, Matthew Green, Mathias Hall-Andersen, Gabriel Kaptchuk',
      year: 2021,
      eprint: '2021/422',
      url: 'https://eprint.iacr.org/2021/422',
    });
    expect(c?.doi).toBeUndefined();
  });

  it('parses a DBLP conference entry: booktitle venue + doi', () => {
    const bib = `@inproceedings{DBLP:conf/crypto/GoelGHK22,
      author       = {Aarushi Goel and Matthew Green and Mathias Hall{-}Andersen and Gabriel Kaptchuk},
      title        = {Stacking Sigmas},
      booktitle    = {{CRYPTO} 2022},
      year         = {2022},
      doi          = {10.1007/978-3-031-15985-5\\_16},
      url          = {https://doi.org/10.1007/978-3-031-15985-5\\_16}
    }`;
    expect(parseBibtex(bib)).toMatchObject({
      venue: 'CRYPTO 2022',
      year: 2022,
      doi: '10.1007/978-3-031-15985-5_16',
      url: 'https://doi.org/10.1007/978-3-031-15985-5_16',
    });
  });

  it('reads quote-delimited values and skips the citekey', () => {
    const c = parseBibtex('@article{key, title = "A Title", year = "1999"}');
    expect(c).toEqual({ paper: 'A Title', year: 1999 });
  });
});
