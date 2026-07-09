import 'dotenv/config';
import { prisma } from '../lib/prisma';

// Shared "semantic" macro vocabulary: definition bodies are written against these
// macro names; a macro set maps them to concrete notation. Swapping the macro set
// re-renders the same body in a different paper's notation.
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

const definitions = [
  {
    title: 'pseudorandom-function',
    categories: ['symmetric', 'foundations'],
    versions: [
      {
        slug: 'default',
        isDefault: true,
        order: 0,
        macros: standardMacros,
        bodyLatex: `**Definition (Pseudorandom Function).** Let $F : \\{0,1\\}^\\secpar \\times \\{0,1\\}^n \\to \\{0,1\\}^m$ be an efficiently computable keyed function. $F$ is a *pseudorandom function* if for every PPT distinguisher $\\adv$ there exists a negligible function $\\negl$ such that

$$\\left| \\Pr_{k \\sample \\{0,1\\}^\\secpar}\\left[ \\adv^{F_k(\\cdot)}(1^\\secpar) = 1 \\right] - \\Pr_{f \\sample \\Funcs[n,m]}\\left[ \\adv^{f(\\cdot)}(1^\\secpar) = 1 \\right] \\right| \\le \\negl(\\secpar).$$`,
      },
      {
        slug: 'concrete',
        isDefault: false,
        order: 1,
        macros: standardMacros,
        bodyLatex: `**Definition (Pseudorandom Function, concrete security).** A keyed function $F : \\{0,1\\}^\\secpar \\times \\{0,1\\}^n \\to \\{0,1\\}^m$ is a $(t, q, \\epsilon)$-*pseudorandom function* if for every distinguisher $\\adv$ running in time at most $t$ and making at most $q$ oracle queries,

$$\\mathsf{Adv}^{\\mathrm{prf}}_{F}(\\adv) := \\left| \\Pr\\left[ \\adv^{F_k(\\cdot)} = 1 \\right] - \\Pr\\left[ \\adv^{f(\\cdot)} = 1 \\right] \\right| \\le \\epsilon.$$`,
      },
    ],
  },
  {
    title: 'ind-cpa',
    categories: ['symmetric', 'encryption'],
    versions: [
      {
        slug: 'default',
        isDefault: true,
        order: 0,
        macros: standardMacros,
        bodyLatex: `**Definition (IND-CPA Security).** A symmetric encryption scheme $\\Pi = (\\Gen, \\Enc, \\Dec)$ has *indistinguishable encryptions under chosen-plaintext attack* if for every PPT adversary $\\adv$ there exists a negligible function $\\negl$ such that

$$\\Pr\\left[ \\mathsf{PrivK}^{\\mathrm{cpa}}_{\\adv,\\Pi}(\\secpar) = 1 \\right] \\le \\frac{1}{2} + \\negl(\\secpar),$$

where in $\\mathsf{PrivK}^{\\mathrm{cpa}}_{\\adv,\\Pi}(\\secpar)$: a key $k \\sample \\Gen(1^\\secpar)$ is sampled; $\\adv^{\\Enc_k(\\cdot)}(1^\\secpar)$ outputs $m_0, m_1$ with $|m_0| = |m_1|$; a bit $b \\sample \\{0,1\\}$ is chosen and $\\adv$ receives $c \\sample \\Enc_k(m_b)$; $\\adv$ (still with oracle access) outputs $b'$, and the experiment evaluates to $1$ iff $b' = b$.`,
      },
    ],
  },
  {
    title: 'ddh',
    categories: ['assumptions', 'public-key'],
    versions: [
      {
        slug: 'default',
        isDefault: true,
        order: 0,
        macros: standardMacros,
        bodyLatex: `**Definition (Decisional Diffie–Hellman).** Let $\\mathbb{G}$ be a cyclic group of prime order $q$ with generator $g$, output by a group-generation algorithm $\\mathcal{G}(1^\\secpar)$. The *DDH assumption* holds for $\\mathcal{G}$ if for every PPT distinguisher $\\adv$,

$$\\left| \\Pr_{x,y \\sample \\mathbb{Z}_q}\\left[ \\adv(g, g^x, g^y, g^{xy}) = 1 \\right] - \\Pr_{x,y,z \\sample \\mathbb{Z}_q}\\left[ \\adv(g, g^x, g^y, g^{z}) = 1 \\right] \\right| \\le \\negl(\\secpar).$$`,
      },
    ],
  },
  {
    title: 'commitment-scheme',
    categories: ['foundations', 'protocols'],
    versions: [
      {
        slug: 'default',
        isDefault: true,
        order: 0,
        macros: standardMacros,
        bodyLatex: `**Definition (Commitment Scheme).** A *commitment scheme* is a pair of PPT algorithms $(\\mathsf{Com}, \\mathsf{Open})$ where $\\mathsf{Com}(1^\\secpar, m; r)$ outputs a commitment $c$, satisfying:

- **Hiding.** For every PPT $\\adv$ and all messages $m_0, m_1$: $\\left| \\Pr[\\adv(\\mathsf{Com}(1^\\secpar, m_0)) = 1] - \\Pr[\\adv(\\mathsf{Com}(1^\\secpar, m_1)) = 1] \\right| \\le \\negl(\\secpar).$
- **Binding.** For every PPT $\\adv$: $\\Pr\\left[ \\mathsf{Com}(1^\\secpar, m_0; r_0) = \\mathsf{Com}(1^\\secpar, m_1; r_1) \\land m_0 \\ne m_1 \\right] \\le \\negl(\\secpar)$ over $\\adv$'s choice of $(m_0, r_0, m_1, r_1)$.`,
      },
    ],
  },
  {
    // Written with the cryptocode LaTeX package (\procedure game box). KaTeX cannot
    // render this — it exists to exercise the Tier-2 (real LaTeX -> SVG) pipeline.
    title: 'euf-cma',
    categories: ['signatures', 'public-key'],
    versions: [
      {
        slug: 'default',
        isDefault: true,
        order: 0,
        macros: standardMacros,
        bodyLatex: `**Definition (EUF-CMA Security).** A signature scheme $\\Sigma = (\\mathsf{KGen}, \\mathsf{Sign}, \\mathsf{Vrfy})$ is *existentially unforgeable under adaptive chosen-message attack* if for every PPT adversary $\\adv$,

$$\\Pr\\left[ \\mathsf{SigForge}_{\\adv,\\Sigma}(\\secpar) = 1 \\right] \\le \\negl(\\secpar),$$

where the experiment $\\mathsf{SigForge}$ is defined as:

\\begin{center}
\\procedure{$\\mathsf{SigForge}_{\\adv,\\Sigma}(\\secpar)$}{
(vk, sk) \\sample \\mathsf{KGen}(1^\\secpar) \\\\
(m^*, \\sigma^*) \\sample \\adv^{\\mathsf{Sign}(sk, \\cdot)}(vk) \\\\
\\pcreturn \\mathsf{Vrfy}(vk, m^*, \\sigma^*) = 1 \\land m^* \\notin \\mathcal{Q}
}
\\end{center}`,
      },
    ],
  },
];

async function main() {
  // idempotent: wipe and re-create (dev seed data only)
  await prisma.definitionVersion.deleteMany();
  await prisma.definition.deleteMany();
  await prisma.macroSet.deleteMany();
  await prisma.category.deleteMany();

  // one shared "standard notation" macro set as each version's default, plus a
  // standalone alternative set to exercise ?macroSetId= re-rendering
  const standardSet = await prisma.macroSet.create({
    data: { name: 'standard-notation', macros: standardMacros },
  });
  const altSet = await prisma.macroSet.create({
    data: { name: 'alternative-notation', macros: altMacros },
  });

  for (const def of definitions) {
    await prisma.definition.create({
      data: {
        title: def.title,
        categories: {
          connectOrCreate: def.categories.map((name) => ({
            where: { name },
            create: { name },
          })),
        },
        versions: {
          create: def.versions.map((v) => ({
            slug: v.slug,
            bodyLatex: v.bodyLatex,
            isDefault: v.isDefault,
            order: v.order,
            defaultMacroSet: { connect: { id: standardSet.id } },
          })),
        },
      },
    });
  }

  console.log(`Seeded ${definitions.length} definitions.`);
  console.log(`Standard macro set uuid: ${standardSet.uuid}`);
  console.log(`Alternative macro set uuid: ${altSet.uuid}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
