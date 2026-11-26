// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { TabMessage, TransitionMessage } from './transition';

const ui = vi.hoisted(() => ({
  toggle: () => {},
  update: vi.fn(),
  scroll: vi.fn(),
  send: vi.fn(async (message: TransitionMessage | TabMessage): Promise<unknown> => message.kind === 'expect-next'),
  onMessage: vi.fn(),
}));
vi.mock('./panel', () => ({
  mountPanel: (_doc: Document, toggle: () => void) => {
    ui.toggle = toggle;
    return { update: ui.update, updateMute() {}, updateVideoSound() {}, remove() {} };
  },
}));
vi.mock('./reader', async (original) => ({
  ...await original<typeof import('./reader')>(),
  locateReader: (frame: HTMLIFrameElement) => ({ doc: frame.contentDocument }),
  scrollReader: ui.scroll,
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage: ui.send, onMessage: { addListener: ui.onMessage, removeListener() {} } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
    storage: { session: {
      values: {} as Record<string, unknown>,
      async get() { return this.values; },
      async set(items: Record<string, unknown>) { Object.assign(this.values, items); },
      async remove(key: string) { delete this.values[key]; },
    } },
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

it.each(['stale', 'ppt-stale', 'confirmed-at-end', 'reader-loading'])('handles two videos and four readers with %s markers', async scenario => {
  vi.useFakeTimers();
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  const { default: script } = await import('../entrypoints/course.content');
  history.replaceState(null, '', '/mycourse/studentstudy?courseid=1&clazzid=2&chapterid=10');
  document.body.innerHTML = `
    <div id="coursetree">
      <div class="posCatalog_select posCatalog_active" data-chapterid="10"><button class="posCatalog_name">第一节</button><span class="jobUnfinishCount">1</span></div>
      <div class="posCatalog_select"><button class="posCatalog_name">6.4 章节图谱</button></div>
      <div class="posCatalog_select"><button class="posCatalog_name">6.5 章节讨论</button></div>
      <div class="posCatalog_select"><button class="posCatalog_name">6.6 章节测验</button></div>
      <div class="posCatalog_select" data-chapterid="11"><button class="posCatalog_name">第二节</button></div>
    </div>
    <input id="curChapterId" value="10">
    <div class="tabtags"><button class="current">慕课视频</button><button>教材+PPT</button></div>
    <section><div class="ans-attach-ct"><video></video></div><div class="ans-attach-ct"><video></video></div></section>`;
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value() {} });
  const section = () => document.querySelector('section')!;
  const reads = new Set<Document>();
  const passes: Document[] = [];
  ui.scroll.mockImplementation((doc: Document) => {
    reads.add(doc);
    if (passes.at(-1) !== doc) passes.push(doc);
    if (reads.size === 4) document.querySelector('.ans-job-icon')!.textContent = '任务点已完成';
    return scenario === 'reader-loading' && reads.size === 4 ? 'loading' : 'bottom';
  });
  const original = document.querySelector('video')!;
  let failedOnce = false;
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLVideoElement) {
    if (this === original || !failedOnce) {
      failedOnce ||= this !== original;
      throw new DOMException('source initializing', 'NotSupportedError');
    }
    if (document.querySelector('#curChapterId')?.getAttribute('value') === '11' && !this.muted) {
      throw new DOMException('gesture needed', 'NotAllowedError');
    }
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('playing'));
  });
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabtags button')];
  let visits = 0;
  const backToVideo = vi.fn();
  tabs[0]!.onclick = backToVideo;
  const renderReading = () => {
    tabs[0]!.classList.remove('current');
    tabs[1]!.classList.add('current');
    section().outerHTML = '<section>' + [1, 2, 3, 4].map((index) =>
      '<div class="ans-attach-ct">' + (index <= 2 ? '<i class="ans-job-icon">' + '任务点' + '</i>' : '')
      + '<iframe class="ans-zt-attach-online"></iframe></div>').join('') + '</section>';
  };
  tabs[1]!.onclick = () => {
    visits++;
    if (scenario === 'ppt-stale') setTimeout(renderReading, 19_000);
    else renderReading();
  };
  if (scenario === 'ppt-stale') {
    const key = 'course-queue:review:' + JSON.stringify([location.origin, '1', '2']);
    sessionStorage.setItem(key, JSON.stringify([{ id: '10', title: '第一节', items: ['慕课视频·视频1', '教材+PPT·资料2'] }]));
  }
  const rows = document.querySelectorAll('.posCatalog_select[data-chapterid]');
  const refreshDirectory = vi.fn();
  rows[0]!.querySelector('button')!.onclick = refreshDirectory;
  const enter = vi.fn(() => {
    if (scenario === 'confirmed-at-end') rows[0]!.querySelector('.jobUnfinishCount')!.outerHTML = '<i class="icon_Completed"></i>';
    rows[0]!.classList.remove('posCatalog_active');
    rows[1]!.classList.add('posCatalog_active');
    document.querySelector('#curChapterId')!.setAttribute('value', '11');
    document.querySelector('.tabtags')!.remove();
    section().outerHTML = '<section class="ans-attach-ct"><video></video></section>';
  });
  rows[1]!.querySelector('button')!.onclick = enter;
  let invalidate = () => {};
  const ctx = { isValid: true, addEventListener() {}, setInterval, onInvalidated: (fn: () => void) => { invalidate = fn; } };
  // WXT supplies the real context when loading the built extension.
  script.main(ctx as unknown as NonNullable<Parameters<typeof script.main>[0]>);
  ui.toggle();
  await vi.advanceTimersByTimeAsync(500);
  original.replaceWith(document.createElement('video'));
  await vi.advanceTimersByTimeAsync(3000);
  function finishVideo(video: HTMLVideoElement) {
    expect(video.paused).toBe(false);
    Object.defineProperty(video, 'ended', { value: true });

    video.dispatchEvent(new Event('ended'));
  }
  const [first, second] = document.querySelectorAll('video');
  finishVideo(first!);
  await vi.advanceTimersByTimeAsync(1500);
  expect(second!.paused).toBe(false);
  expect(visits).toBe(0);
  finishVideo(second!);
  if (scenario === 'confirmed-at-end' || scenario === 'ppt-stale') {
    first!.parentElement!.classList.add('ans-job-finished');
    second!.parentElement!.classList.add('ans-job-finished');
  }
  if (scenario === 'ppt-stale') {
    await vi.advanceTimersByTimeAsync(15_000);
    expect(visits).toBe(1);
    expect(reads.size).toBe(0);
    expect(ui.update.mock.lastCall?.[2]).toBe(true);
  }
  await vi.advanceTimersByTimeAsync(35_000);
  expect(reads.size).toBe(4);
  if (scenario === 'reader-loading') {
    expect(enter).not.toHaveBeenCalled();
    expect(ui.update.mock.lastCall?.[2]).toBe(false);
  } else {
    expect(passes).toEqual([...reads, ...[...reads].slice(1)]);
    expect(enter).toHaveBeenCalledTimes(1);
    const last = document.querySelector('video')!;
    expect(last.muted).toBe(true);
    last.parentElement!.classList.add('ans-job-finished');
    finishVideo(last);
    await vi.advanceTimersByTimeAsync(300_000);
    const message = {
      'stale': '已到目录末尾。 待核对小节：第一节（慕课视频·视频1、慕课视频·视频2、教材+PPT·资料2）。',
      'ppt-stale': '已到目录末尾。 待核对小节：第一节（教材+PPT·资料2）。',
      'confirmed-at-end': '已到目录末尾。',
    }[scenario];
    expect(ui.update.mock.lastCall).toEqual(['第二节', message, false]);
    expect(enter).toHaveBeenCalledTimes(1);
    expect(play.mock.calls.length).toBeGreaterThanOrEqual(5);
  }
  expect(visits).toBe(1);
  expect(refreshDirectory).not.toHaveBeenCalled();
  expect(backToVideo).not.toHaveBeenCalled();
  invalidate();
});


it.each([false, true])('opens the PPT tab once after a completed numbered 视频 tab (hidden=%s)', async hidden => {
  vi.useFakeTimers();
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
  const { default: script } = await import('../entrypoints/course.content');
  history.replaceState(null, '', '/mycourse/studentstudy?courseid=1&clazzid=2&chapterid=10');
  document.body.innerHTML = '<div class="tabs"><button class="active">视频目录</button><button>笔记</button></div><iframe id="iframe"></iframe>';
  const content = document.querySelector('iframe')!.contentDocument!;
  content.body.scrollIntoView = vi.fn();
  content.body.innerHTML = `
    <div class="study-switch"><span class="currents">1 视频</span><a href="javascript:">2 教材+PPT</a></div>
    <section class="ans-attach-ct ans-job-finished"><video></video></section>`;
  const ppt = content.querySelector('a')!;
  const click = vi.fn((event: Event) => {
    event.preventDefault();
    content.querySelector('.currents')!.classList.remove('currents');
    ppt.classList.add('currents');
    content.querySelector('section')!.outerHTML = '<section class="ans-job-finished"><i class="ans-job-icon">任务点已完成</i></section>';
  });
  ppt.addEventListener('click', click);
  const other = vi.fn();
  document.querySelector('.tabs')!.addEventListener('click', other);
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
  const ctx = { isValid: true, addEventListener() {}, onInvalidated() {},
    setInterval(fn: () => void, ms: number) { if (!hidden) setInterval(fn, ms); } };
  ui.send.mockImplementation(async message => {
    if (message.kind !== 'next-background-step') return false;
    return new Promise(resolve => setTimeout(() => resolve(true), 1000));
  });
  try {
    script.main(ctx as unknown as NonNullable<Parameters<typeof script.main>[0]>);
    ui.toggle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(click).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  } finally {
    ctx.isValid = false;
    ui.send.mockImplementation(async message => message.kind === 'expect-next');
  }
});
