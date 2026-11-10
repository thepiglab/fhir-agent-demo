// The empty state's question bank, built per patient and role. Each question belongs to exactly one
// role, so the physician, nurse and front-desk lists never share a question:
//  - templates filled from this patient's own chart summary, each written for one role and used only
//    when the chart has what it asks about (so the agent can answer it);
//  - this patient's benchmark questions whose family is meant for that role (`intended_voice`), in
//    that role's own wording: clean, true-premise and read-only, without the JSON answer contract.
import { app } from '../../app/state.ts';
import { fetchData } from '../../chart/data.ts';

export type Voice = 'physician' | 'nurse' | 'clerical';

interface Item { label?: string; date?: string | null; status?: string; with?: string[]; criticality?: string | null }
interface Lab { name: string; latest?: { date?: string; text?: string; flag?: string | null }; previous?: { date?: string } | null }
interface Summary {
  problems?: Item[];
  medications?: Item[];
  allergies?: { items?: Item[]; none_known?: Item[] };
  labs?: Lab[];
  vitals?: { name: string }[];
  encounters?: { total?: number; recent?: Item[] };
  appointments?: { upcoming?: Item[]; past?: Item[] };
  orders?: Item[];
  documents?: { total?: number; recent?: Item[] };
  alerts?: Item[];
}
interface Task { id: string | null; family: string; prompt: string; persona?: string; intended_voice?: string; style?: string; premise?: string; required_changes?: unknown[] }

/** The question a benchmark prompt asks, without the answer contract appended to it. */
const question = (prompt: string): string => prompt.split(/\n\s*Reply with only JSON/)[0]!.trim();
/**
 * A suggestion without the patient's MRN: the patient is already chosen, and Ask mode adds the MRN
 * to the prompt itself ("Context: patient MRN …"). "SYN-767dc0dd06 as of 2024-09-13: provide …"
 * becomes "As of 2024-09-13: provide …"; "For MRN SYN-…, check …" becomes "Check …".
 */
const withoutMrn = (q: string): string => {
  const out = q
    .replace(/^\s*(?:for|re:?|patient)?\s*(?:mrn:?\s*)?SYN-[0-9a-f]+\s*[,:;-]?\s*/i, '')
    .replace(/\s*\(\s*(?:mrn:?\s*)?SYN-[0-9a-f]+\s*\)/gi, '')
    .replace(/\s+(?:for|of|on)\s+(?:patient\s+)?(?:mrn:?\s*)?SYN-[0-9a-f]+/gi, '')
    .replace(/\s*(?:mrn:?\s*)?SYN-[0-9a-f]+/gi, '')
    .replace(/\s+([,.?;:])/g, '$1')
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
};
/** Lower-case the first letter mid-sentence, but keep acronyms (TSH, HbA1c, IVIG) as they are. */
const lower = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** "2023-03-03T08:00:00Z" → "March 2023". */
const month = (iso: string | undefined): string => {
  const d = iso ? new Date(iso.slice(0, 10) + 'T12:00:00Z') : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'the prior draw';
};
/** A drug's name without its strength and form: "Acetaminophen 160 mg/5 mL oral solution" → "acetaminophen". */
const drug = (label: string): string => lower(label.replace(/\s+\d.*$/, '').replace(/\s+(oral|tablet|capsule|solution|injection|preparation)\b.*$/i, '').trim());
const clean = (s: string | undefined): string => (s ?? '').replace(/\s*·.*$/, '').trim();
/** Short, human labels only (synthetic placeholders such as "Fictional …" make poor questions). */
const usable = (s: string): boolean => !!s && s.length <= 48 && !/fictional|synthetic|benchmark|workflow/i.test(s);
const firstUsable = (items: (Item | undefined)[] | undefined, n = 1): string[] =>
  [...new Set((items ?? []).map((i) => clean(i?.label)).filter(usable))].slice(0, n);

function pronouns(gender: unknown): { he: string; his: string; him: string } {
  if (gender === 'male') return { he: 'he', his: 'his', him: 'him' };
  if (gender === 'female') return { he: 'she', his: 'her', him: 'her' };
  return { he: 'they', his: 'their', him: 'them' };
}

/** Questions written for one role, from what this chart actually holds. */
function templates(s: Summary, voice: Voice, g: unknown, counts: Record<string, number>): string[] {
  const { he, his, him } = pronouns(g);
  const problems = firstUsable(s.problems, 2);
  const meds = firstUsable(s.medications, 2);
  const labs = (s.labs ?? []).filter((l) => usable(l.name));
  const trended = labs.filter((l) => l.previous);
  const flagged = labs.filter((l) => l.latest?.flag);
  const allergies = firstUsable(s.allergies?.items, 1);
  const upcoming = s.appointments?.upcoming ?? [];
  const past = s.appointments?.past ?? [];
  const orders = firstUsable((s.orders ?? []).filter((o) => o.status === 'active'), 1);
  const alerts = firstUsable(s.alerts, 1);
  const vitals = (s.vitals ?? []).map((v) => v.name);
  const visits = s.encounters?.total ?? counts.Encounter ?? 0;
  const has = (type: string): boolean => (counts[type] ?? 0) > 0;
  const out: (string | false)[] = [];
  if (voice === 'physician') {
    out.push(
      !!trended[0] && `How has ${his} ${lower(trended[0].name)} moved since ${month(trended[0].previous?.date)}, and is the latest value in range?`,
      trended.length > 1 && `Compare the two most recent results for each of ${his} repeated lab tests. What changed?`,
      (problems.length > 0 || meds.length > 0) && `Summarize ${his} documented conditions, medications and allergies, and flag anything missing.`,
      problems.length > 1 && `Which of ${his} conditions are marked active, and when did each start?`,
      !!problems[0] && `Is ${lower(problems[0])} still active, and what is ${he} being treated with for it?`,
      !!problems[1] && `What did the most recent note say about ${his} ${lower(problems[1])}?`,
      problems.length > 1 && `Which of ${his} problems were addressed at the most recent visit, and what changed in the plan?`,
      !!meds[0] && `What condition is ${drug(meds[0])} prescribed for, according to the chart?`,
      !!meds[1] && `Has the ${drug(meds[1])} order changed in the past year? Look for dose or status changes.`,
      flagged.length > 0 && `Which of ${his} recent labs are out of range, and was any of them repeated?`,
      !!orders[0] && `Has the ${lower(orders[0])} been resulted? If so, what did it show?`,
      labs.length > 2 && `Summarize ${his} most recent labs: what stands out?`,
      visits > 0 && `Summarize ${his} most recent visit: the date, the reason, and any linked results or notes.`,
      (s.orders?.length ?? 0) > 1 && `Which orders are still open in ${his} chart, and has any of them been completed?`,
      has('DiagnosticReport') && `What did ${his} most recent diagnostic report conclude?`,
    );
  } else if (voice === 'nurse') {
    out.push(
      vitals.length > 0 && `Show ${his} latest vital signs and compare each with the previous measurement.`,
      vitals.includes('Blood pressure') && `What was ${his} last blood pressure, and was it rechecked afterwards?`,
      !!allergies[0] && `What reaction is recorded for ${his} ${lower(allergies[0])} allergy, and how severe is it?`,
      !allergies[0] && (s.allergies?.none_known?.length ?? 0) > 0 && `Is "no known allergies" documented for ${him}, and when was it last confirmed?`,
      !!meds[0] && `What dose and schedule is ${he} on for ${drug(meds[0])}?`,
      meds.length > 1 && `List ${his} current medications with dose, route and frequency, and flag any missing instructions.`,
      has('MedicationRequest') && `Which of ${his} prescriptions have a dispensing record, and which have no documented fill?`,
      !!meds[1] && `When was ${his} ${drug(meds[1])} last ordered, and is the order still active?`,
      (has('MedicationAdministration') || has('MedicationDispense')) && `Which medications were given or dispensed to ${him} most recently, and when?`,
      !!alerts[0] && `Is there anything I should know before I see ${him}, like safety flags or special needs?`,
      !!labs[0] && `When was ${his} last ${lower(labs[0].name)} drawn, and what was the result?`,
      (s.documents?.total ?? 0) > 0 && `Find ${his} most recent clinical note and summarize its follow-up instructions.`,
      has('Task') && `Are there open care tasks on ${his} chart, and who are they assigned to?`,
      has('Specimen') && `Is there a specimen from ${him} still waiting on a result?`,
    );
  } else {
    out.push(
      upcoming.length > 0 && `When is ${his} next appointment, who is it with, and is it confirmed?`,
      upcoming.length === 0 && past.length > 0 && `When was ${his} last appointment, and has a follow-up been booked since?`,
      past.some((a) => /cancel|noshow|no-show/i.test(a.status ?? '')) && `Was any of ${his} appointments cancelled or missed, and was it rebooked?`,
      [...upcoming, ...past].some((a) => a.with?.length) && `Which clinic and provider does ${he} usually see?`,
      visits > 1 && `List ${his} three most recent visits with their dates, types and locations.`,
      (s.documents?.total ?? 0) > 0 && `What documents are on file for ${him}, with their types, dates and status?`,
      !!orders[0] && `Is there a referral or order for ${him} that still needs to be scheduled?`,
      has('Coverage') && `What insurance is on file for ${him}, and is the coverage active?`,
      has('Communication') && `Are there messages from ${him} or ${his} family still waiting for a reply?`,
      has('Task') && `Is there a front-desk task on ${his} chart, such as a call back or form to send?`,
      has('Consent') && `Is there a signed consent or release form on file for ${him}?`,
      `What contact preferences and interpreter needs are documented for ${him}?`,
    );
  }
  return out.filter((q): q is string => !!q);
}

/** This patient's questions for one role (unshuffled). */
export async function questionBank(patientId: string, voice: Voice): Promise<string[]> {
  const entry = app.patients.find((p) => p.id === patientId);
  const shard = entry?.shard_sha;
  const [summary, tasks] = await Promise.all([
    typeof shard === 'string'
      ? fetchData<{ summary: Summary }>(`charts/${shard}/${patientId}.json`).then((c) => c.summary).catch(() => ({}) as Summary)
      : Promise.resolve({} as Summary),
    app.cohort
      ? fetchData<{ tasks: Task[] }>(`${app.cohort.id}/tasks/${patientId}.json`).then((f) => f.tasks).catch(() => [] as Task[])
      : Promise.resolve([] as Task[]),
  ]);
  const native = tasks
    .filter((t) => t.intended_voice === voice && t.style === 'clean' && t.premise === 'true' && !t.required_changes?.length)
    // One wording per question family: the role's own if there is one.
    .sort((a, b) => Number(b.persona === voice) - Number(a.persona === voice))
    .filter((t, i, all) => all.findIndex((u) => u.family === t.family) === i)
    .map((t) => withoutMrn(question(t.prompt)))
    .filter((q) => q.length >= 20)
    .filter((q) => q.length <= 220);
  return [...new Set([...native, ...templates(summary, voice, entry?.gender, (entry?.counts ?? {}) as Record<string, number>)])];
}
