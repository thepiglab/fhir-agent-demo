// The LFM3 runtime yields to the browser with requestAnimationFrame while it loads, and
// animation frames do not fire in a hidden tab or an occluded window (where
// document.hidden can still be false), so loading stalls until the page is shown. Run each
// callback on the next frame or after 100 ms, whichever comes first.
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  let done = false;
  const run = (time: number) => { if (!done) { done = true; callback(time); } };
  setTimeout(() => run(performance.now()), 100);
  return raf(run);
};
