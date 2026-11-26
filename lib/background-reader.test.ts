// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readerOrigin, readerProgress, readerStep, scrollReader } from './reader';

const harness = vi.hoisted(() => ({
  toggle: () => {}, update: vi.fn(), listen: vi.fn(), send: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: harness.send, onMessage: { addListener: harness.listen, removeListener() {} } },
  tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
  storage: { session: { async set() {}, async get() { return {}; } } },
} }));
vi.mock('./panel', () => ({ mountPanel: (_: Document, toggle: () => void) => {
  harness.toggle = toggle;
  return { update: harness.update, updateVideoSound() {}, updateMute() {}, remove() {} };
} }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

it.each(['complete', 'pause'])('handles delayed PPT replies with no page timer or foreground visit (%s)', async mode => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal('defineBackground', (setup: () => void) => setup());
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  await import('../entrypoints/background');
  const dispatch = harness.listen.mock.lastCall![0];
  harness.send.mockImplementation(message => new Promise(resolve => {
    if (message.kind === 'get-muted') return resolve(false);
    dispatch(message, { url: document.URL, frameId: 0, tab: { id: 2 } }, resolve);
  }));
  const { default: script } = await import('../entrypoints/course.content');
  history.replaceState(null, '', '/mycourse/studentstudy?courseid=1&clazzid=2&chapterid=10');
  document.body.innerHTML = `
    <div id="coursetree"><div class="posCatalog_select posCatalog_active" data-chapterid="10"><button class="posCatalog_name">资料</button></div>
    <div class="posCatalog_select" data-chapterid="11"><button class="posCatalog_name">下一小节</button></div></div>
    <input id="curChapterId" value="10">
    <section class="ans-attach-ct"><i class="ans-job-icon">任务点</i>
    <iframe loading="lazy" src="https://pan-yz.chaoxing.com/screen/v2/deck"></iframe></section>`;
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value() {} });
  const frame = document.querySelector('iframe')!;
  const target = frame.contentWindow!;
  Object.defineProperty(frame, 'contentDocument', { get: () => null });
  const geometryFrame = document.createElement('iframe');
  document.body.append(geometryFrame);
  const viewer = geometryFrame.contentDocument!;
  const scroller = viewer.createElement('div');
  scroller.id = 'viewerContainer';
  scroller.style.overflowY = 'auto';
  // A separate document supplies deterministic viewport dimensions to the production scroller.
  viewer.body.append(scroller);
  Object.defineProperties(scroller, { clientHeight: { value: 100 }, scrollHeight: { value: 460 } });
  const offsets: number[] = [];
  scroller.scrollBy = ((options: ScrollToOptions) => {
    scroller.scrollTop = Math.min(360, scroller.scrollTop + (options.top ?? 0));
    offsets.push(scroller.scrollTop);
  }) as Element['scrollBy'];
  let bottomReports = 0;
  vi.spyOn(target, 'postMessage').mockImplementation((request, origin) => {
    expect(origin).toBe(readerOrigin);
    expect(request.kind).toBe(readerStep);
    const result = scrollReader(viewer);
    // The first response outlasts the old 12-second stop condition.
    setTimeout(() => {
      window.dispatchEvent(new MessageEvent('message', { source: target, origin: readerOrigin,
        data: { ...request, kind: readerProgress, result } }));
      if (result === 'bottom') bottomReports++;
    }, offsets.length === 1 && request.sequence === 1 ? 18_000 : 500);
  });
  const enter = vi.fn(() => {
    document.querySelector('.posCatalog_active')!.classList.remove('posCatalog_active');
    document.querySelector('[data-chapterid="11"]')!.classList.add('posCatalog_active');
    document.querySelector<HTMLInputElement>('#curChapterId')!.value = '11';
    document.querySelector('section')!.outerHTML = '<section class="ans-job-finished"><video></video></section>';
  });
  document.querySelector<HTMLButtonElement>('[data-chapterid="11"] button')!.onclick = enter;
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const listeners = new AbortController();
  let invalidate = () => {};
  const ctx = { isValid: true, setInterval() { /* No document timer fires. */ },
    addEventListener(node: EventTarget, name: string, fn: EventListener) { node.addEventListener(name, fn, { signal: listeners.signal }); },
    onInvalidated(fn: () => void) { invalidate = fn; } };
  script.main(ctx as unknown as NonNullable<Parameters<typeof script.main>[0]>);
  harness.toggle();
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(harness.update.mock.lastCall?.[2]).toBe(true);
  expect(target.postMessage, String(harness.update.mock.lastCall)).toHaveBeenCalled();
  expect(offsets, String(harness.update.mock.lastCall)).toEqual([90]);
  if (mode === 'pause') harness.toggle();
  await vi.advanceTimersByTimeAsync(18_000);
  if (mode === 'complete') {
    expect(offsets).toEqual([90, 180, 270, 360]);
    expect(bottomReports).toBeGreaterThanOrEqual(2);

    await vi.advanceTimersByTimeAsync(6000);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(harness.update.mock.lastCall).toEqual(['下一小节', '已到目录末尾。 待核对小节：资料（资料1）。', false]);
  } else {
    expect(enter).not.toHaveBeenCalled();
    expect(offsets).toEqual([90]);
    expect(harness.update.mock.lastCall?.[2]).toBe(false);
  }
  listeners.abort();
  invalidate();
});
