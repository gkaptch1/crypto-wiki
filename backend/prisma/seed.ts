import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { macroHash } from '../src/lib/hash';

// Shared "semantic" macro vocabulary: definition bodies are written against
// these macro names; a macro set maps them to concrete notation. Swapping the
// macro set re-renders the same body in a different paper's notation.
const standardMacros = {
  '\\secpar': '\\lambda',
  '\\adv': '\\mathcal{A}',
  '\\negl': '\\mathsf{negl}',
  '\\sample': '\\stackrel{\\$}{\\leftarrow}',
  '\\Gen': '\\mathsf{Gen}',
  '\\Enc': '\\mathsf{Enc}',
  '\\Dec': '\\mathsf{Dec}',
  '\\Funcs': '\\mathsf{Funcs}',
};

// Same vocabulary, different notation (the "my paper uses different letters" case).
const altMacros = {
  '\\secpar': 'n',
  '\\adv': 'D',
  '\\negl': '\\epsilon',
  '\\sample': '\\leftarrow',
  '\\Gen': '\\mathsf{KeyGen}',
  '\\Enc': '\\mathsf{E}',
  '\\Dec': '\\mathsf{D}',
  '\\Funcs': '\\mathcal{F}',
};

interface SeedRevision {
  bodyLatex: string;
  commentaryMd?: string;
  status: 'draft' | 'published';
}

interface SeedFormulation {
  slug: string;
  isDefault?: boolean;
  citation?: {
    paper?: string;
    authors?: string;
    venue?: string;
    year?: number;
    eprint?: string;
  };
  // ordered oldest → newest; published ones get numbers r1, r2, ... in order
  revisions: SeedRevision[];
}

interface SeedDefinition {
  slug: string;
  title: string;
  categories: string[];
  formulations: SeedFormulation[];
}

const definitions: SeedDefinition[] = [
  {
    slug: 'prf',
    title: 'Pseudorandom Function',
    categories: ['symmetric', 'foundations'],
    formulations: [
      {
        slug: 'standard',
        isDefault: true,
        citation: {
          paper: 'How to Construct Random Functions',
          authors: 'Goldreich, Goldwasser, Micali',
          venue: 'JACM',
          year: 1986,
        },
        revisions: [
          {
            // r1: earlier wording — kept published so @r1 pinning has a target
            status: 'published',
            bodyLatex: `\\textbf{Definition (Pseudorandom Function).}
Let $F : \\{0,1\\}^\\secpar \\times \\{0,1\\}^n \\to \\{0,1\\}^m$ be an efficiently
computable keyed function. $F$ is a \\emph{pseudorandom function} if for every
PPT distinguisher $\\adv$,
\\[
\\left| \\Pr\\left[ \\adv^{F_k(\\cdot)}(1^\\secpar) = 1 \\right]
- \\Pr\\left[ \\adv^{f(\\cdot)}(1^\\secpar) = 1 \\right] \\right|
\\le \\negl(\\secpar),
\\]
where $k \\sample \\{0,1\\}^\\secpar$ and $f \\sample \\Funcs[n,m]$.`,
            commentaryMd: 'A PRF is indistinguishable from a truly random function by any efficient distinguisher with oracle access.',
          },
          {
            // r2: current wording with explicit probability subscripts
            status: 'published',
            bodyLatex: `\\textbf{Definition (Pseudorandom Function).}
Let $F : \\{0,1\\}^\\secpar \\times \\{0,1\\}^n \\to \\{0,1\\}^m$ be an efficiently
computable keyed function. $F$ is a \\emph{pseudorandom function} if for every
PPT distinguisher $\\adv$ there exists a negligible function $\\negl$ such that
\\[
\\left| \\Pr_{k \\sample \\{0,1\\}^\\secpar}\\left[ \\adv^{F_k(\\cdot)}(1^\\secpar) = 1 \\right]
- \\Pr_{f \\sample \\Funcs[n,m]}\\left[ \\adv^{f(\\cdot)}(1^\\secpar) = 1 \\right] \\right|
\\le \\negl(\\secpar).
\\]`,
            commentaryMd: `A PRF is indistinguishable from a truly random function by any efficient distinguisher with oracle access.

Introduced by Goldreich, Goldwasser and Micali. See also the [[prp]] and the concrete-security formulation in the tab above.`,
          },
        ],
      },
      {
        slug: 'concrete',
        revisions: [
          {
            status: 'published',
            bodyLatex: `\\textbf{Definition (Pseudorandom Function, concrete security).}
A keyed function $F : \\{0,1\\}^\\secpar \\times \\{0,1\\}^n \\to \\{0,1\\}^m$ is a
$(t, q, \\epsilon)$-\\emph{pseudorandom function} if for every distinguisher
$\\adv$ running in time at most $t$ and making at most $q$ oracle queries,
\\[
\\mathsf{Adv}^{\\mathrm{prf}}_{F}(\\adv) :=
\\left| \\Pr\\left[ \\adv^{F_k(\\cdot)} = 1 \\right]
- \\Pr\\left[ \\adv^{f(\\cdot)} = 1 \\right] \\right| \\le \\epsilon.
\\]`,
            commentaryMd: 'The concrete-security style makes the resources of the distinguisher explicit instead of quantifying over all PPT machines.',
          },
        ],
      },
    ],
  },
  {
    slug: 'ind-cpa',
    title: 'IND-CPA Security',
    categories: ['symmetric', 'encryption'],
    formulations: [
      {
        slug: 'game-based',
        isDefault: true,
        revisions: [
          {
            status: 'published',
            bodyLatex: `\\textbf{Definition (IND-CPA Security).}
A symmetric encryption scheme $\\Pi = (\\Gen, \\Enc, \\Dec)$ has
\\emph{indistinguishable encryptions under chosen-plaintext attack} if for
every PPT adversary $\\adv$ there exists a negligible function $\\negl$ such that
\\[
\\Pr\\left[ \\mathsf{PrivK}^{\\mathrm{cpa}}_{\\adv,\\Pi}(\\secpar) = 1 \\right]
\\le \\frac{1}{2} + \\negl(\\secpar).
\\]
In the experiment $\\mathsf{PrivK}^{\\mathrm{cpa}}_{\\adv,\\Pi}(\\secpar)$: a key
$k \\sample \\Gen(1^\\secpar)$ is sampled; $\\adv^{\\Enc_k(\\cdot)}(1^\\secpar)$
outputs $m_0, m_1$ with $|m_0| = |m_1|$; a bit $b \\sample \\{0,1\\}$ is chosen
and $\\adv$ receives $c \\sample \\Enc_k(m_b)$; $\\adv$ (still with oracle
access) outputs $b'$, and the experiment evaluates to $1$ iff $b' = b$.`,
            commentaryMd: 'The adversary keeps oracle access after receiving the challenge ciphertext — this is what makes the attack "chosen-plaintext".',
          },
        ],
      },
    ],
  },
  {
    slug: 'ddh',
    title: 'Decisional Diffie–Hellman',
    categories: ['assumptions', 'public-key'],
    formulations: [
      {
        slug: 'standard',
        isDefault: true,
        revisions: [
          {
            status: 'published',
            bodyLatex: `\\textbf{Definition (Decisional Diffie–Hellman).}
Let $\\mathbb{G}$ be a cyclic group of prime order $q$ with generator $g$,
output by a group-generation algorithm $\\mathcal{G}(1^\\secpar)$. The
\\emph{DDH assumption} holds for $\\mathcal{G}$ if for every PPT distinguisher
$\\adv$,
\\[
\\left| \\Pr_{x,y \\sample \\mathbb{Z}_q}\\left[ \\adv(g, g^x, g^y, g^{xy}) = 1 \\right]
- \\Pr_{x,y,z \\sample \\mathbb{Z}_q}\\left[ \\adv(g, g^x, g^y, g^{z}) = 1 \\right] \\right|
\\le \\negl(\\secpar).
\\]`,
          },
        ],
      },
    ],
  },
  {
    slug: 'commitment-scheme',
    title: 'Commitment Scheme',
    categories: ['foundations', 'protocols'],
    formulations: [
      {
        slug: 'standard',
        isDefault: true,
        revisions: [
          {
            status: 'published',
            bodyLatex: `\\textbf{Definition (Commitment Scheme).}
A \\emph{commitment scheme} is a pair of PPT algorithms
$(\\mathsf{Com}, \\mathsf{Open})$ where $\\mathsf{Com}(1^\\secpar, m; r)$ outputs
a commitment $c$, satisfying:
\\begin{itemize}
\\item \\textbf{Hiding.} For every PPT $\\adv$ and all messages $m_0, m_1$:
\\[
\\left| \\Pr[\\adv(\\mathsf{Com}(1^\\secpar, m_0)) = 1]
- \\Pr[\\adv(\\mathsf{Com}(1^\\secpar, m_1)) = 1] \\right| \\le \\negl(\\secpar).
\\]
\\item \\textbf{Binding.} For every PPT $\\adv$:
\\[
\\Pr\\left[ \\mathsf{Com}(1^\\secpar, m_0; r_0) = \\mathsf{Com}(1^\\secpar, m_1; r_1)
\\land m_0 \\ne m_1 \\right] \\le \\negl(\\secpar)
\\]
over $\\adv$'s choice of $(m_0, r_0, m_1, r_1)$.
\\end{itemize}`,
            commentaryMd: 'Digital envelope: commit now, open later. Hiding protects the sender, binding protects the receiver.',
          },
        ],
      },
    ],
  },
  {
    // Written with the cryptocode LaTeX package (\procedure game box). Plain
    // KaTeX cannot render this — it exercises the katex-cryptocode shim and
    // the Tier-2 (real LaTeX -> SVG) pipeline.
    slug: 'euf-cma',
    title: 'EUF-CMA Security',
    categories: ['signatures', 'public-key'],
    formulations: [
      {
        slug: 'game-based',
        isDefault: true,
        revisions: [
          {
            status: 'published',
            bodyLatex: `\\textbf{Definition (EUF-CMA Security).}
A signature scheme $\\Sigma = (\\mathsf{KGen}, \\mathsf{Sign}, \\mathsf{Vrfy})$ is
\\emph{existentially unforgeable under adaptive chosen-message attack} if for
every PPT adversary $\\adv$,
\\[
\\Pr\\left[ \\mathsf{SigForge}_{\\adv,\\Sigma}(\\secpar) = 1 \\right] \\le \\negl(\\secpar),
\\]
where the experiment $\\mathsf{SigForge}$ is defined as:

\\begin{center}
\\procedure{$\\mathsf{SigForge}_{\\adv,\\Sigma}(\\secpar)$}{
  (vk, sk) \\sample \\mathsf{KGen}(1^\\secpar) \\\\
  (m^*, \\sigma^*) \\sample \\adv^{\\mathsf{Sign}(sk, \\cdot)}(vk) \\\\
  \\pcreturn \\mathsf{Vrfy}(vk, m^*, \\sigma^*) = 1 \\land m^* \\notin \\mathcal{Q}
}
\\end{center}`,
            commentaryMd: '$\\mathcal{Q}$ is the set of messages queried to the signing oracle.',
          },
          {
            // an in-progress edit, invisible on public permalinks
            status: 'draft',
            bodyLatex: `\\textbf{Definition (EUF-CMA Security).}
DRAFT: rewording in progress.`,
            commentaryMd: 'Draft: clarify bookkeeping of the query set.',
          },
        ],
      },
    ],
  },
];

async function main() {
  // idempotent: wipe and re-create (dev seed data only)
  await prisma.revision.deleteMany();
  await prisma.formulation.deleteMany();
  await prisma.definition.deleteMany();
  await prisma.macroSetSnapshot.deleteMany();
  await prisma.macroSet.deleteMany();
  await prisma.category.deleteMany();

  const standardSet = await prisma.macroSet.create({
    data: { name: 'standard-notation', macros: standardMacros, visibility: 'public' },
  });
  const altSet = await prisma.macroSet.create({
    data: { name: 'alternative-notation', macros: altMacros, visibility: 'public' },
  });
  // anonymous set (double-blind submission) with a pinned snapshot, to
  // exercise the attribution-stripping and ?macros=<uuid>@<hash> paths
  const anonSet = await prisma.macroSet.create({
    data: { name: 'submission-notation', macros: altMacros, visibility: 'anonymous' },
  });
  const anonHash = macroHash(altMacros);
  await prisma.macroSetSnapshot.create({
    data: { macroSetId: anonSet.id, hash: anonHash, macros: altMacros },
  });

  for (const def of definitions) {
    const created = await prisma.definition.create({
      data: {
        slug: def.slug,
        title: def.title,
        categories: {
          connectOrCreate: def.categories.map((name) => ({ where: { name }, create: { name } })),
        },
      },
    });

    for (const [order, f] of def.formulations.entries()) {
      const formulation = await prisma.formulation.create({
        data: {
          definitionId: created.id,
          slug: f.slug,
          isDefault: f.isDefault ?? false,
          order,
          citePaper: f.citation?.paper ?? null,
          citeAuthors: f.citation?.authors ?? null,
          citeVenue: f.citation?.venue ?? null,
          citeYear: f.citation?.year ?? null,
          citeEprint: f.citation?.eprint ?? null,
          defaultMacroSetId: standardSet.id,
        },
      });

      let number = 0;
      for (const r of f.revisions) {
        const published = r.status === 'published';
        if (published) number += 1;
        await prisma.revision.create({
          data: {
            formulationId: formulation.id,
            status: r.status,
            number: published ? number : null,
            bodyLatex: r.bodyLatex,
            commentaryMd: r.commentaryMd ?? '',
            publishedAt: published ? new Date() : null,
          },
        });
      }
    }
  }

  console.log(`Seeded ${definitions.length} definitions.`);
  console.log(`Standard macro set:    ${standardSet.uuid}`);
  console.log(`Alternative macro set: ${altSet.uuid}`);
  console.log(`Anonymous macro set:   ${anonSet.uuid} (pinned @${anonHash.slice(0, 16)})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
