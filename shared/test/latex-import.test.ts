import { describe, expect, it } from 'vitest';
import { extractFromLatex, stripLatexComments } from '../src/latex-import.js';

describe('stripLatexComments', () => {
  it('cuts % comments but keeps escaped \\% and line count', () => {
    const src = 'a \\% real percent % gone\nnext line';
    expect(stripLatexComments(src)).toBe('a \\% real percent \nnext line');
    expect(stripLatexComments(src).split('\n').length).toBe(2);
  });

  it('blanks comment/verbatim environments without shifting lines', () => {
    const src = 'before\n\\begin{comment}\n\\newcommand{\\evil}{x}\n\\end{comment}\nafter';
    const out = stripLatexComments(src);
    expect(out).not.toContain('\\evil');
    expect(out.split('\n').length).toBe(5);
  });
});

describe('macro extraction', () => {
  it('parses the \\newcommand family, braced and unbraced names, starred', () => {
    const result = extractFromLatex(`
      \\newcommand{\\adv}{\\mathcal{A}}
      \\newcommand*\\negl{\\mathsf{negl}}
      \\renewcommand{\\emptyset}{\\varnothing}
      \\newcommand{\\game}[2]{\\mathsf{Exp}^{#1}_{#2}}
    `);
    const byName = Object.fromEntries(result.macros.map((m) => [m.name, m]));
    expect(byName['\\adv'].body).toBe('\\mathcal{A}');
    expect(byName['\\negl'].body).toBe('\\mathsf{negl}');
    expect(byName['\\emptyset'].kind).toBe('renewcommand');
    expect(byName['\\game'].numArgs).toBe(2);
    expect(result.macroMap['\\game']).toBe('\\mathsf{Exp}^{#1}_{#2}');
  });

  it('handles nested braces in bodies', () => {
    const result = extractFromLatex('\\newcommand{\\pk}{\\mathsf{pk}_{\\{i\\}}^{x}}');
    expect(result.macroMap['\\pk']).toBe('\\mathsf{pk}_{\\{i\\}}^{x}');
  });

  it('flags optional-argument macros as not katexSafe but keeps them', () => {
    const result = extractFromLatex('\\newcommand{\\enc}[2][pk]{\\mathsf{Enc}_{#1}(#2)}');
    const m = result.macros.find((x) => x.name === '\\enc')!;
    expect(m.optionalDefault).toBe('pk');
    expect(m.katexSafe).toBe(false);
    expect(m.issue).toMatch(/optional argument/);
    expect(result.macroMap['\\enc']).toBeUndefined();
  });

  it('transcribes DeclareMathOperator with and without star', () => {
    const result = extractFromLatex(`
      \\DeclareMathOperator{\\lsb}{lsb}
      \\DeclareMathOperator*{\\argmax}{arg\\,max}
    `);
    expect(result.macroMap['\\lsb']).toBe('\\operatorname{lsb}');
    expect(result.macroMap['\\argmax']).toBe('\\operatorname*{arg\\,max}');
  });

  it('transcribes DeclarePairedDelimiter with an issue note', () => {
    const result = extractFromLatex('\\DeclarePairedDelimiter\\abs{\\lvert}{\\rvert}');
    const m = result.macros.find((x) => x.name === '\\abs')!;
    expect(m.body).toBe('\\lvert #1 \\rvert');
    expect(m.katexSafe).toBe(true);
    expect(m.issue).toMatch(/unstarred/);
  });

  it('parses simple \\def and rejects delimited parameter text', () => {
    const result = extractFromLatex(`
      \\def\\secpar{\\lambda}
      \\def\\pair#1#2{(#1, #2)}
      \\def\\until#1stop{#1}
    `);
    expect(result.macroMap['\\secpar']).toBe('\\lambda');
    expect(result.macroMap['\\pair']).toBe('(#1, #2)');
    const bad = result.macros.find((x) => x.name === '\\until')!;
    expect(bad.katexSafe).toBe(false);
    expect(bad.issue).toMatch(/delimited/);
  });

  it('keeps internal @-names out of the macro map', () => {
    const result = extractFromLatex('\\def\\foo@bar{x}');
    expect(result.macros.find((x) => x.name === '\\foo@bar')!.katexSafe).toBe(false);
    expect(Object.keys(result.macroMap)).toHaveLength(0);
  });

  it('providecommand keeps an existing definition; renewcommand overrides', () => {
    const result = extractFromLatex(`
      \\newcommand{\\adv}{\\mathcal{A}}
      \\providecommand{\\adv}{IGNORED}
      \\newcommand{\\negl}{old}
      \\renewcommand{\\negl}{\\mathsf{negl}}
    `);
    expect(result.macroMap['\\adv']).toBe('\\mathcal{A}');
    expect(result.macroMap['\\negl']).toBe('\\mathsf{negl}');
  });

  it('ignores commented-out declarations', () => {
    const result = extractFromLatex('% \\newcommand{\\dead}{x}\n\\newcommand{\\live}{y}');
    expect(result.macroMap['\\dead']).toBeUndefined();
    expect(result.macroMap['\\live']).toBe('y');
  });
});

describe('theorem environments and candidates', () => {
  const PAPER = `
    \\documentclass{article}
    \\newtheorem{theorem}{Theorem}
    \\newtheorem{definition}[theorem]{Definition}
    \\newtheorem{experiment}[theorem]{Experiment}
    \\newcommand{\\prf}{\\mathsf{PRF}}
    \\newcommand{\\advantage}{\\mathsf{Adv}}
    \\newcommand{\\game}{\\advantage^{\\prf}}
    \\begin{document}
    \\begin{definition}[Pseudorandom Function]\\label{def:prf}
      A function \\prf is pseudorandom if \\game is small.
    \\end{definition}
    \\begin{theorem} Not a definition. \\end{theorem}
    \\begin{experiment}
      The distinguishing experiment.
    \\end{experiment}
    \\end{document}
  `;

  it('extracts definition-like envs (incl. Experiment) but not theorems', () => {
    const result = extractFromLatex(PAPER);
    const kinds = result.candidates.map((c) => c.envName);
    expect(kinds).toContain('definition');
    expect(kinds).toContain('experiment');
    expect(kinds).not.toContain('theorem');
  });

  it('captures title, label, body, and the transitive macro closure', () => {
    const result = extractFromLatex(PAPER);
    const def = result.candidates.find((c) => c.envName === 'definition')!;
    expect(def.title).toBe('Pseudorandom Function');
    expect(def.label).toBe('def:prf');
    expect(def.body).toContain('is pseudorandom');
    // \game expands to \advantage^{\prf}: all three must be in the closure
    expect(def.usedMacros).toEqual(['\\advantage', '\\game', '\\prf']);
  });

  it('extracts \\begin{definition} even when the class predeclares it (llncs)', () => {
    const result = extractFromLatex(`
      \\documentclass{llncs}
      \\begin{document}
      \\begin{definition} Predeclared. \\end{definition}
      \\end{document}
    `);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].displayName).toBe('Definition');
  });

  it('honors an explicit environments override', () => {
    const result = extractFromLatex(PAPER, { environments: ['theorem'] });
    expect(result.candidates.map((c) => c.envName)).toEqual(['theorem']);
  });

  it('understands \\spnewtheorem and \\declaretheorem', () => {
    const result = extractFromLatex(`
      \\spnewtheorem{defn}{Definition}{\\bfseries}{\\itshape}
      \\declaretheorem[name=Security Game,numberwithin=section]{secgame}
      \\begin{defn} From llncs style. \\end{defn}
      \\begin{secgame} From thmtools. \\end{secgame}
    `);
    expect(result.candidates.map((c) => c.displayName)).toEqual(['Definition', 'Security Game']);
  });
});

describe('procedure extraction', () => {
  it('extracts standalone game boxes with the full invocation as body', () => {
    const result = extractFromLatex(`
      \\begin{figure}
      \\procedure[linenumbering]{$\\mathsf{Exp}^{\\text{ind-cpa}}$}{
        b \\sample \\bin \\\\
        \\pcreturn b
      }
      \\end{figure}
    `);
    expect(result.candidates).toHaveLength(1);
    const p = result.candidates[0];
    expect(p.kind).toBe('procedure');
    expect(p.body).toMatch(/^\\procedure\[linenumbering\]/);
    expect(p.body).toContain('\\pcreturn b');
  });

  it('emits nested same-name environments as separate candidates', () => {
    const result = extractFromLatex(`
      \\newtheorem{definition}{Definition}
      \\begin{definition}[Outer] outer text
        \\begin{definition}[Inner] inner text \\end{definition}
      \\end{definition}
    `);
    expect(result.candidates.map((c) => c.title)).toEqual(['Outer', 'Inner']);
  });

  it('does not double-report a procedure inside an extracted definition', () => {
    const result = extractFromLatex(`
      \\newtheorem{definition}{Definition}
      \\begin{definition}
        \\procedure{G}{x \\\\ y}
      \\end{definition}
    `);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].kind).toBe('theorem-env');
  });
});

describe('multi-file papers', () => {
  it('follows \\input from the documentclass root and skips unreachable files', () => {
    const result = extractFromLatex({
      'main.tex': '\\documentclass{article}\\input{macros}\\begin{document}\\input{body.tex}\\end{document}',
      'macros.tex': '\\newcommand{\\adv}{\\mathcal{A}}',
      'body.tex': '\\newtheorem{definition}{Definition}\\begin{definition}Uses \\adv.\\end{definition}',
      'old-draft.tex': '\\newcommand{\\stale}{x}',
    });
    expect(result.scannedFiles).toEqual(['main.tex', 'macros.tex', 'body.tex']);
    expect(result.macroMap['\\adv']).toBeDefined();
    expect(result.macroMap['\\stale']).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('old-draft.tex'))).toBe(true);
    expect(result.candidates[0].usedMacros).toEqual(['\\adv']);
    expect(result.candidates[0].file).toBe('body.tex');
  });

  it('follows \\usepackage into shipped .sty files, silently skipping standard packages', () => {
    const result = extractFromLatex({
      'main.tex': '\\documentclass{article}\\usepackage{amsmath,style/mymacros}\\begin{document}\\end{document}',
      'style/mymacros.sty': '\\newcommand{\\adv}{\\mathcal{A}}',
    });
    expect(result.macroMap['\\adv']).toBe('\\mathcal{A}');
    expect(result.warnings.some((w) => w.includes('amsmath'))).toBe(false);
  });

  it('never treats internal @-environments as definition-like', () => {
    const result = extractFromLatex(`
      \\newtheorem{rep@definition}{Definition}
      \\begin{rep@definition} internal \\end{rep@definition}
    `);
    expect(result.candidates).toHaveLength(0);
  });

  it('warns about missing \\input targets and multiple roots', () => {
    const result = extractFromLatex({
      'a.tex': '\\documentclass{article}\\input{gone}',
      'b.tex': '\\documentclass{article}',
    });
    expect(result.warnings.some((w) => w.includes('\\input{gone}'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('multiple \\documentclass roots'))).toBe(true);
  });
});
