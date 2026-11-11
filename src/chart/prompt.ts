// The two prompt layouts the demo's models were trained in (better-questions' package
// lfm3-prompt-v0235/README.md, verified on 355 real episodes):
//
//   'v0.2.2'    system = BASE; user = the question with its answer contract on the next line.
//               v0.2.2 and v0.2.3 rows (and the demo's v0.2.3 export); SFT v0.6.1 and earlier.
//   'v0.2.3.4'  system = BASE + "\n" + CONVENTIONS + "\nAnswer contract for this request:\n" + contract;
//               user = the question only. v0.2.3.4 / v0.2.3.5 rows; SFT v0.7.
//
// A task row from a v0.2.3.4+ export carries `prompt` (the question only), `answer_contract` and
// `charting_conventions`; a v0.2.3 row carries the contract inside `prompt`. Both layouts can be
// built from either row: the contract is split off a v0.2.3 prompt, or appended to a v0.2.3.5 one
// (`prompt_with_contract_v023`, where a row keeps it, is v0.2.3's exact wording). Keyed rows have
// no contract: BASE and the prompt as is, in both layouts.

export type PromptLayout = 'v0.2.2' | 'v0.2.3.4';
export const PROMPT_LAYOUTS: readonly PromptLayout[] = ['v0.2.2', 'v0.2.3.4'];
export const isPromptLayout = (v: unknown): v is PromptLayout => v === 'v0.2.2' || v === 'v0.2.3.4';

export interface LayoutTask {
  prompt: string;
  answer_contract?: string | null;
  charting_conventions?: string | null;
  prompt_with_contract_v023?: string | null;
}

const CONTRACT_START = /\n\s*Reply with only JSON/;
const CONTRACT_HEADER = '\nAnswer contract for this request:\n';

/** A v0.2.3-style prompt split into its question and the contract line(s) after it. */
export function splitContract(prompt: string): { question: string; contract: string | null } {
  const at = prompt.search(CONTRACT_START);
  if (at < 0) return { question: prompt, contract: null };
  return { question: prompt.slice(0, at), contract: prompt.slice(at).replace(/^\n\s*/, '') };
}

/** The question and contract of a row, whichever export it came from. */
export function questionAndContract(task: LayoutTask): { question: string; contract: string | null } {
  if (task.answer_contract) return { question: task.prompt, contract: task.answer_contract };
  return splitContract(task.prompt);
}

/** The v0.2.3.4 system prompt: BASE, the charting conventions, then the request's contract. */
export function systemWithContract(base: string, conventions: string, contract: string): string {
  return `${base}\n${conventions}${CONTRACT_HEADER}${contract}`;
}

/**
 * A benchmark task's system and user turns in a layout. `conventions` is used when the row does
 * not carry its own (a v0.2.3 row); the v0.2.3.4 layout needs one or the other and throws without.
 */
export function taskMessages(layout: PromptLayout, base: string, task: LayoutTask, conventions?: string | null): { system: string; user: string } {
  const { question, contract } = questionAndContract(task);
  if (!contract) return { system: base, user: task.prompt };  // keyed rows: the contract is in the prompt
  if (layout === 'v0.2.2') {
    const user = task.prompt_with_contract_v023 || (task.answer_contract ? `${task.prompt}\n${task.answer_contract}` : task.prompt);
    return { system: base, user };
  }
  const conv = task.charting_conventions || conventions;
  if (!conv) throw new Error('The v0.2.3.4 prompt layout needs the charting conventions: re-export the data from natural v0.2.3.4 or later');
  return { system: systemWithContract(base, conv, contract), user: question };
}

/**
 * A free question's (Ask mode) system prompt. v0.2.2: BASE, with the question and its context
 * line in the user turn (demo/app.py's user_prompt). v0.2.3.4: BASE and the conventions, and the
 * family contract when the request names one. Every v0.2.3.x training row had a contract; a free
 * question has none, so the contract section is left out (the closest the layout allows).
 */
export function askSystem(layout: PromptLayout, base: string, conventions: string | null | undefined, contract: string | null): string {
  if (layout === 'v0.2.2' || !conventions) return base;
  return contract ? systemWithContract(base, conventions, contract) : `${base}\n${conventions}`;
}
