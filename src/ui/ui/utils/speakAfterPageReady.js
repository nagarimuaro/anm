const DEFAULT_PAGE_READY_DELAY_MS = 500;

export default function speakAfterPageReady(electron, text, delayMs = DEFAULT_PAGE_READY_DELAY_MS) {
  if (!electron || !text) return () => {};

  let timeoutId = null;
  let firstFrame = null;
  let secondFrame = null;
  let cancelled = false;

  firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          electron.ipcRenderer.invoke('voice:speakOnce', text).catch(() => {});
        }
      }, delayMs);
    });
  });

  return () => {
    cancelled = true;
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    if (timeoutId) clearTimeout(timeoutId);
  };
}
