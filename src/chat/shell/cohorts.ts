// Plain names and one-line descriptions of the benchmark datasets (cohorts).
import type { Cohort } from '../../chart/data.ts';
import { fmtNum, plural } from '../../app/dom.ts';

const NATURAL_ABOUT = 'How physicians, nurses and front-desk staff ask, typos, vague and false-premise questions included';
/**
 * Any natural-track release reads the same. The page's own set is the held-out patients (never
 * trained or tuned on), named plainly. The developer view also lists the dev patients (used for
 * tuning, so not a clean test) and earlier releases (named with their version).
 */
function natural(c: Cohort): { name: string; short: string; about: string } | undefined {
  const m = /^natural-(v[\d.]+?)(-heldout)?$/.exec(c.id);
  if (!m) return undefined;
  if (m[2]) return { name: 'Natural prompts', short: 'Natural', about: `${NATURAL_ABOUT}; patients kept out of training and tuning` };
  if (/dev patients/i.test(c.label)) return { name: 'Natural prompts, dev patients', short: 'Dev', about: 'Patients used for tuning, so not a clean test' };
  return { name: `Natural prompts ${m[1]} (previous release)`, short: `Natural ${m[1]}`, about: NATURAL_ABOUT };
}
const COHORT_TEXT: Record<string, { name: string; short: string; about: string }> = {
  'keyed-v0.6.0': { name: 'Keyed synthetic hospital', short: 'Keyed', about: 'Keyed task prompts: reads and chart changes' },
  'clinical-hard-v0.6.0': { name: 'Clinical hard', short: 'Hard', about: 'Harder clinical reasoning over longer charts' },
  'clinical-v0.5.0': { name: 'Clinical', short: 'Clinical', about: 'The earlier clinical suite' },
};
const plainLabel = (c: Cohort): string => c.label.replace(/\s*\([^)]*\)\s*$/, '');
const textOf = (c: Cohort) => COHORT_TEXT[c.id] ?? natural(c);
export const cohortName = (c: Cohort): string => textOf(c)?.name ?? plainLabel(c);
export const cohortShort = (c: Cohort): string => textOf(c)?.short ?? plainLabel(c).split(/\s+/)[0] ?? c.id;
export const cohortLine = (c: Cohort): string =>
  [textOf(c)?.about, `${plural(c.patients, 'patient')} · ${fmtNum(c.tasks)} questions`].filter(Boolean).join(' · ');

/** Developer-view-only sets: API-style prompts (keyed task text, identifier systems as hints) and earlier releases. */
export const isTechnical = (c: Cohort): boolean => c.technical === true;
