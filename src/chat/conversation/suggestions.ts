export interface Suggestion { voice: string; question: string; title?: string }
export interface SuggestionSummary {
  suggestions?: Suggestion[];
  medications?: unknown[]; problems?: unknown[]; labs?: unknown[]; vitals?: unknown[];
  alerts?: unknown[]; orders?: unknown[];
  allergies?: { items?: unknown[]; none_known?: unknown[] };
  encounters?: { total?: number }; documents?: { total?: number };
  appointments?: { total?: number };
}

/** Read-only prompts supported by the FHIR search tools, grounded in available chart sections. */
export function buildSuggestions(s: SuggestionSummary): Suggestion[] {
  const out = [...(s.suggestions ?? [])];
  const add = (voices: string[], title: string, question: string) => {
    for (const voice of voices) out.push({ voice, title, question });
  };
  const clinical = ['physician', 'nurse'];
  add(clinical, 'Chart at a glance', 'Summarize the documented conditions, medications and allergies. Cite the chart records and flag missing information.');
  add(['clerical'], 'Contact preferences', 'What contact preferences and interpreter needs are documented for this patient? Cite the records and say what is missing.');
  if (s.medications?.length) {
    add(clinical, 'Medication review', 'List the current medications with their documented dose, route and frequency. Flag missing instructions and cite the source records.');
    add(['nurse'], 'Prescription status', 'Which current prescriptions have a dispensing record, and which have no documented fill? Cite the prescription and dispensing records.');
  }
  if (s.problems?.length) add(clinical, 'Problem list', 'Which conditions are marked active in the chart? Include their recorded onset dates when available and cite the source records.');
  if (s.labs?.length) {
    add(clinical, 'Latest lab results', 'List the latest available lab results with dates, units and reference ranges where documented. Cite each result.');
    add(clinical, 'Compare recent labs', 'Compare the two most recent results for each repeated lab test. Show dates and changes without inferring a diagnosis. Cite the results.');
  }
  if (s.vitals?.length) add(clinical, 'Vital signs', 'Show the latest documented vital signs and compare each with its previous measurement. Include dates, units and source records.');
  if (s.allergies?.items?.length || s.allergies?.none_known?.length) add(clinical, 'Allergy record', 'What allergies and reactions are documented? Distinguish explicit no-known-allergy records from missing information and cite the records.');
  if (s.encounters?.total) {
    add(clinical, 'Last visit', 'Summarize the most recent completed encounter: date, reason and linked observations or notes. Cite the records and identify missing details.');
    add(['clerical'], 'Visit history', 'List the three most recent completed visits with dates, visit types and locations where documented. Cite the encounter records.');
  }
  if (s.documents?.total) {
    add(clinical, 'Recent notes', 'Find the most recent clinical note and summarize its documented follow-up instructions. Cite the note; say if no instructions are available.');
    add(['clerical'], 'Documents on file', 'List the most recent documents on file, with their types, dates and statuses. Cite the source records.');
  }
  if (s.appointments?.total) add(['clerical', 'nurse'], 'Appointment check', 'Which appointments are upcoming as of the chart date? Include their status, time and location where documented, and cite the records.');
  if (s.orders?.length) add(['clerical', 'nurse', 'physician'], 'Open orders', 'Which orders are still open in the chart? Include the order date and any linked completion record. Cite the sources.');
  return out;
}

export function suggestionTitle(s: Suggestion): string {
  if (s.title) return s.title;
  const q = s.question.toLowerCase();
  if (/hemoglobin|potassium|lab/.test(q)) return 'Explore lab results';
  if (/referral/.test(q)) return 'Follow a referral';
  if (/pharmacy|prescription/.test(q)) return 'Check prescriptions';
  if (/insurance/.test(q)) return 'Review coverage';
  if (/directive/.test(q)) return 'Check documents';
  return 'Explore the chart';
}

/** Fisher–Yates, preferring questions outside the previous set when reshuffling. */
export function sampleSuggestions(pool: Suggestion[], previous: Suggestion[] = []): Suggestion[] {
  const unique = [...new Map(pool.map(s => [s.question, s])).values()];
  const seen = new Set(previous.map(s => s.question));
  const fresh = unique.filter(s => !seen.has(s.question));
  const candidates = fresh.length >= 3 ? fresh : unique;
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, 3);
}
