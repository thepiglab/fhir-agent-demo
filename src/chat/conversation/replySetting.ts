// The written summary after an answer (src/chart/reply.ts): on by default, switchable in Settings.
// It is shown only when its checks pass (cited records, values, the write log); the agent-scope
// pilot found LFM3's unchecked replies wrong on 20-33% of episodes, so the checks stay.
import { storage } from '../../app/dom.ts';

/** On unless the reader switched it off (a new key, so the old experimental opt-in does not carry over). */
export const replyEnabled = (): boolean => storage.get<boolean>('written-summary', true) !== false;
export const replyToggle = replyEnabled;
export const setReplyToggle = (on: boolean): void => storage.set('written-summary', on);
