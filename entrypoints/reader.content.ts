import { readerOrigin, readerPath, readerProgress, readerStep, scrollReader } from '../lib/reader';

export default defineContentScript({
  matches: [readerOrigin + readerPath + '*'],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    if (window.top === window) return;
    ctx.addEventListener(window, 'message', (event) => {
      if (!event.source || event.source !== window.top || !/^https:\/\/(?:[\w-]+\.)*chaoxing\.com$/.test(event.origin)) return;
      if (event.data?.kind !== readerStep || typeof event.data.id !== 'string' || !Number.isSafeInteger(event.data.sequence)) return;
      const result = scrollReader(document);
      event.source.postMessage({ kind: readerProgress, id: event.data.id, sequence: event.data.sequence, result }, { targetOrigin: event.origin });
    });
  },
});
