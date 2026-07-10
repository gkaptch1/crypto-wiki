/**
 * Core entries for the macro-name registry (PLAN.md "Layered macros"): the
 * canonical vocabulary notation sets restyle. Seeded into the MacroName table
 * (dev seed + test reset); editors extend the registry through the API.
 *
 * Deliberately absent: the pc* pseudocode keywords and \procedure plumbing
 * from the shim base — those are rendering machinery, not notation, and a
 * set redefining them would break game boxes. Register one explicitly if a
 * real need ever shows up.
 */

export interface CoreMacroName {
  name: string;
  description: string;
}

const notation: CoreMacroName[] = [
  { name: '\\secpar', description: 'Security parameter (λ)' },
  { name: '\\secparam', description: 'Security parameter in unary (1^λ)' },
  { name: '\\negl', description: 'Negligible function' },
  { name: '\\poly', description: 'Polynomial (asymptotics)' },
  { name: '\\ppt', description: 'Probabilistic polynomial time' },
  { name: '\\sample', description: 'Uniform/random sampling arrow' },
  { name: '\\bin', description: 'The set {0,1}' },
  { name: '\\concat', description: 'String concatenation' },
  { name: '\\emptystring', description: 'The empty string' },
];

// \adv..\zdv — cryptocode's calligraphic party/adversary letters
const adversaries: CoreMacroName[] = Array.from({ length: 26 }, (_, i) => {
  const lower = String.fromCharCode(97 + i);
  const upper = String.fromCharCode(65 + i);
  return {
    name: `\\${lower}dv`,
    description: `Calligraphic ${upper} — party/adversary letter (cryptocode convention)`,
  };
});

// algorithm-name conventions (semantic — THE names the \enc-vs-\encode
// contamination rule is about)
const algorithms: CoreMacroName[] = [
  { name: '\\enc', description: 'Encryption algorithm of an encryption scheme' },
  { name: '\\dec', description: 'Decryption algorithm of an encryption scheme' },
  { name: '\\kgen', description: 'Key-generation algorithm' },
  { name: '\\Gen', description: 'Key/parameter generation algorithm (display form)' },
  { name: '\\Enc', description: 'Encryption algorithm (display form)' },
  { name: '\\Dec', description: 'Decryption algorithm (display form)' },
  { name: '\\encode', description: 'Encoder of a code (NOT encryption — see \\enc)' },
  { name: '\\decode', description: 'Decoder of a code (NOT decryption — see \\dec)' },
  { name: '\\sign', description: 'Signing algorithm of a signature scheme' },
  { name: '\\verify', description: 'Verification algorithm of a signature scheme' },
  { name: '\\hash', description: 'Hash function' },
  { name: '\\prf', description: 'Pseudorandom function' },
  { name: '\\commit', description: 'Commitment algorithm of a commitment scheme' },
  { name: '\\open', description: 'Opening/decommitment algorithm' },
  { name: '\\Funcs', description: 'The set of all functions (PRF security games)' },
];

export const coreMacroNames: CoreMacroName[] = [...notation, ...adversaries, ...algorithms];
