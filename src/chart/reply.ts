// The reply turn (demo only): after the agent submits its structured answer, one tool-free LFM3
// call writes 1–4 plain sentences for the clinician, citing the records the agent cited. Option
// (b) of the fhir-env repo's docs/research/agent-scope.md; the prompt and the checks are those of
// its pilot, scripts/agent_scope_pilot.py at 482f2a4 (SUMMARY_SYSTEM, SUMMARY_RULES,
// summary_messages, deterministic). The reply is shown only when it passes the checks in code;
// otherwise the page shows the answer card alone. Benchmark questions get no reply: they are
// scored on the structured answer.
import { pyDumps } from '../fhir/store.ts';
import type { Rec } from '../fhir/pyrt.ts';

export const SUMMARY_SYSTEM =
  "You are the answer-writing step of an EHR search assistant. A search agent has already queried the patient's "
  + 'FHIR chart and returned a structured answer with the records it used. Write the reply the clinician sees.';
export const SUMMARY_RULES = `Write 1-4 sentences in plain clinical language.
- Lead with the direct answer to the request.
- Use only facts in the structured answer and the records shown. Cite each fact with its record reference in square brackets, e.g. [Observation/abc123].
- If the structured answer has null for a field, say the chart does not document it; never infer that it is normal, absent or not needed.
- Say a record was created, changed or deleted only if the write log shows it.
- Do not give treatment, dosing or management recommendations of your own.
- No preamble, no headings, no JSON.`;

const DROP_KEYS = new Set(['meta', 'text']);
export const MAX_RESOURCE_CHARS = 2500;
export const MAX_EVIDENCE_CHARS = 14000;
/** Longer than four sentences of plain clinical language could be: refused. */
export const MAX_WORDS = 140;
export const REF = /\b([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{6,64})\b/g;
export const NUMBER = /(?<![\w/.-])(\d+(?:\.\d+)?)(?![\w/])/g;

// A sentence that says a write happened: a past-tense verb of changing the chart. The agent-scope
// pilot's worst failures were these ("a note has been sent" with an empty write log, "released" after
// a 403), and its other checks caught none of them. A write that did happen shows in the write log;
// a sentence that cites a record it was read from ("the referral was cancelled on Mar 3 [ServiceRequest/…]")
// states a chart fact, not an action, and is left alone.
const WRITE_VERBS: Record<string, string[]> = {
  // Verbs that also state chart facts ("ordered", "recorded", "completed", "closed", "resolved") are left out.
  POST: ['created', 'added', 'sent', 'submitted', 'filed', 'placed', 'scheduled', 'booked', 'messaged', 'notified'],
  PUT: ['updated', 'changed', 'saved', 'released', 'revoked', 'cancelled', 'canceled', 'edited', 'reassigned', 'rescheduled'],
  DELETE: ['deleted', 'removed', 'cancelled', 'canceled', 'discarded'],
};
const VERB_METHODS = new Map<string, Set<string>>();
for (const [method, verbs] of Object.entries(WRITE_VERBS)) for (const v of verbs) VERB_METHODS.set(v, (VERB_METHODS.get(v) ?? new Set()).add(method));
// "has been sent", "was created", "I have updated", "successfully saved", "is now released".
const WRITE_CLAIM = new RegExp(
  `\\b(?:(?:has|have|had|was|were|been|is|are|now|successfully|already|I|we|I've|we've)\\s+(?:\\w+\\s+)?)(${[...VERB_METHODS.keys()].join('|')})\\b`, 'gi');

export interface ReplyInput {
  /** The clinician's question as asked (free-response questions carry no answer contract). */
  question: string;
  /** The agent's structured answer (final.answer). */
  answer: unknown;
  /** Cited records the agent read, trimmed, in citation order, within MAX_EVIDENCE_CHARS. */
  evidence: { ref: string; json: string }[];
  /** The run's writes: method, reference and status. */
  writes: { method: string; ref: string; status: string }[];
}

/** pilot trim(): the record without meta and narrative text, cut at MAX_RESOURCE_CHARS. */
export function trimRecord(resource: Rec): string {
  const clean: Rec = {};
  for (const [k, v] of Object.entries(resource)) if (!DROP_KEYS.has(k)) clean[k] = v;
  const text = pyDumps(clean);
  return text.length <= MAX_RESOURCE_CHARS ? text : text.slice(0, MAX_RESOURCE_CHARS) + '…';
}

/** The records to show the writer: the agent's citations that it read, as the pilot's episode(). */
export function replyEvidence(cited: string[], read: Set<string>, resources: Map<string, Rec>): ReplyInput['evidence'] {
  const out: ReplyInput['evidence'] = [];
  let used = 0;
  for (const ref of [...new Set(cited)]) {
    const resource = resources.get(ref);
    if (!resource || !read.has(ref)) continue;
    const json = trimRecord(resource);
    if (used + json.length > MAX_EVIDENCE_CHARS) break;
    out.push({ ref, json });
    used += json.length;
  }
  return out;
}

/** pilot summary_messages(). */
export function replyMessages(input: ReplyInput): { role: 'system' | 'user'; content: string }[] {
  const records = input.evidence.map((e) => `[${e.ref}] ${e.json}`).join('\n') || '(none)';
  const writes = input.writes.map((w) => `${w.method} ${w.ref} -> ${w.status}`).join('\n') || '(no writes)';
  const user = `## Clinician's request\n${input.question}\n\n`
    + `## Structured answer from the search agent\n\`\`\`json\n${JSON.stringify(input.answer ?? null, null, 1)}\n\`\`\`\n\n`
    + `## Records the agent cited\n${records}\n\n## Write log\n${writes}\n\n`
    + `## Instructions\n${SUMMARY_RULES}`;
  return [{ role: 'system', content: SUMMARY_SYSTEM }, { role: 'user', content: user }];
}

/** pilot clean_reply(): no thinking block, trimmed. */
export const cleanReply = (text: string): string => text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

export interface ReplyCheck {
  ok: boolean;
  /** Why it was refused, in words (empty when ok). */
  problems: string[];
  /** The references the reply cites, in order of first mention. */
  refs: string[];
  words: number;
}

/** A number as compared: no leading zeros, no trailing decimal zeros ("08" and "8", "13.0" and "13"). */
const canonical = (n: string): string => {
  const [whole, frac = ''] = n.split('.');
  const f = frac.replace(/0+$/, '');
  return (whole!.replace(/^0+(?=\d)/, '') || '0') + (f ? '.' + f : '');
};
/** Every number in the support text, whole: the parts of dates and times too (2023-03-08: 2023, 3, 8). */
function supportNumbers(text: string): Set<string> {
  return new Set([...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => canonical(m[0])));
}

/**
 * pilot deterministic(), as a gate (numbers compared whole rather than as substrings, so a reply's
 * "1.3" is not supported by a record's "11.3"): the reply must cite, cite only records the agent cited and
 * the writer was shown, state no number that the structured answer, those records or the
 * question do not contain, and stay short.
 */
export function checkReply(reply: string, input: ReplyInput): ReplyCheck {
  const shown = new Set(input.evidence.map((e) => e.ref));
  const refs = [...new Set([...reply.matchAll(REF)].map((m) => `${m[1]}/${m[2]}`))];
  const support = supportNumbers(pyDumps(input.answer ?? null) + ' ' + input.evidence.map((e) => e.json).join(' ') + ' ' + input.question);
  const numbers = [...reply.replace(REF, ' ').matchAll(NUMBER)].map((m) => m[1]!);
  const words = reply.split(/\s+/).filter(Boolean).length;
  const problems: string[] = [];
  if (!reply) problems.push('empty');
  // A reply that states numbers from the chart must cite where they come from; one with no
  // citations and no numbers beyond the question's ("no potassium in the past 6 weeks": the chart
  // does not document it) passes, as it states nothing from a record to check.
  const asked = supportNumbers(input.question);
  if (reply && !refs.length && numbers.some((n) => !asked.has(canonical(n)))) problems.push('cites no record');
  const foreign = refs.filter((r) => !shown.has(r));
  if (foreign.length) problems.push(`cites records the agent did not cite: ${foreign.join(', ')}`);
  const unsupported = [...new Set(numbers.filter((n) => !support.has(canonical(n))))];
  if (unsupported.length) problems.push(`states numbers not in the cited records: ${unsupported.join(', ')}`);
  if (words > MAX_WORDS) problems.push(`too long (${words} words)`);
  if (/```|^\s*[{[]/.test(reply)) problems.push('not plain sentences');
  problems.push(...writeClaims(reply, input.writes, shown));
  return { ok: !problems.length, problems, refs, words };
}

/**
 * The write log against the reply: a sentence claiming a write the log does not show as
 * succeeded (no 2xx write of the matching method), and citing no record, is a problem.
 */
export function writeClaims(reply: string, writes: ReplyInput['writes'], shown: Set<string>): string[] {
  const done = new Set(writes.filter((w) => /^2\d\d$/.test(w.status)).map((w) => w.method));
  const problems: string[] = [];
  for (const sentence of reply.split(/(?<=[.!?])\s+|\n+/)) {
    const cited = [...sentence.matchAll(REF)].some((m) => shown.has(`${m[1]}/${m[2]}`));
    if (cited) continue;
    for (const m of sentence.matchAll(WRITE_CLAIM)) {
      const methods = VERB_METHODS.get(m[1]!.toLowerCase());
      if (methods && ![...methods].some((x) => done.has(x))) {
        const failed = writes.filter((w) => !/^2\d\d$/.test(w.status)).map((w) => `${w.method} -> ${w.status}`);
        problems.push(`claims a write the log does not show ("${m[1]!.toLowerCase()}")${failed.length ? `; the log has ${failed.join(', ')}` : ''}`);
      }
    }
  }
  return [...new Set(problems)];
}

/** What the done trace carries about the reply turn. */
export interface ReplyResult {
  state: 'shown' | 'refused' | 'failed' | 'stopped';
  /** The reply as written (also when refused, for the developer view). */
  text: string;
  problems: string[];
  refs: string[];
  seconds: number;
  usage: { prompt_tokens?: number; completion_tokens?: number };
}
