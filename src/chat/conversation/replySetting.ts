// The written summary after an answer (src/chart/reply.ts) is experimental and off by default: the
// agent-scope pilot found LFM3's replies wrong on 20-33% of episodes where the agent itself was
// right (write claims against the write log, dropped fields). It can be switched on from the
// developer view only; the answer card is the product.
import { app } from '../../app/state.ts';
import { storage } from '../../app/dom.ts';

/** True only in the developer view with the experimental toggle on. */
export const replyEnabled = (): boolean => app.dev && storage.get<boolean>('experimental-reply', false) === true;
export const replyToggle = (): boolean => storage.get<boolean>('experimental-reply', false) === true;
export const setReplyToggle = (on: boolean): void => storage.set('experimental-reply', on);
