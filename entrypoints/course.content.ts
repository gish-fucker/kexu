import { browser } from 'wxt/browser';
import {
  canOpenTaskCard, catalogChapterById, chapterCompletion, chapterContent, chapterTitle, completed,
  currentChapter, currentChapterId, findNextChapter, getCoursePage, inspectLesson,
  readTaskCards, studyPaths, taskCardKind, tasksReady, type CoursePage, type Lesson, type NextChapter,
} from '../lib/course-page';
import { mountPanel } from '../lib/panel';
import { locateReader, readerOrigin, readerProgress, readerStep, scrollReader, type ScrollResult } from '../lib/reader';
import { type TabMessage, type TabMutedUpdate, type TransitionMessage, transitionLifetime } from '../lib/transition';

const loadWait = 12_000;
const cardSwitchWait = 30_000;
const readerSettle = 1_350;
const readerReplyWait = 30_000;
const chapterStopMessages = {
  last: '已到目录末尾。',
  locked: '后续小节尚未开放，请按学习通提示解锁后再点「开始」。',
  manual: '请在学习通目录中选择下一节。',
};
const testMatches = import.meta.env.MODE === 'demo';
const matches = studyPaths.flatMap((path) => [
  'https://*.chaoxing.com' + path + '*',
  ...(testMatches ? ['http://localhost' + path + '*'] : []),
]);

interface Playing {
  video: HTMLVideoElement;
  label: string;
  listeners: AbortController;
  endedAt?: number;
  started: boolean;
  attempting: boolean;
  retryAt: number;
  deadline: number;
  clickedControl: boolean;
  lastError?: string;
}

interface Reading {
  frame: HTMLIFrameElement;
  source: string;
  label: string;
  id: string;
  target?: Window;
  lastMoved: number;
  bottomAt?: number;
  lastBottomAt?: number;
  sentAt?: number;
  sentSequence?: number;
  receivedSequence?: number;
}

interface CardLocation {
  content: Document;
  index?: number;
  firstTask?: Element;
}

interface Run {
  deadline: number;
  chapter?: Element;
  chapterId: string;
  card?: CardLocation;
  verifiedCards: Set<number>;
  readerBottoms: Map<HTMLIFrameElement, string>;
  playing?: Playing;
  reading?: Reading;
  scanStartedAt?: number;
  checkingReaders?: boolean;
  endedVideos: Map<HTMLVideoElement, string>;
  switching?:
    | { kind: 'card'; index: number; from: CardLocation; deadline: number }
    | { kind: 'chapter'; next: NextChapter; from: CardLocation; deadline: number; id?: string };
}

async function send(message: TransitionMessage | TabMessage): Promise<boolean | null> {
  try {
    const value = await browser.runtime.sendMessage(message);
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

function locationOf(lesson: Lesson, content: Document, index: number | undefined): CardLocation {
  return {
    content, index,
    firstTask: lesson.kind === 'tasks' || lesson.kind === 'skip' ? lesson.firstTask : undefined,
  };
}

function autoplayBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError';
}

export default defineContentScript({
  matches,
  runAt: 'document_idle',
  main(ctx) {
    if (!studyPaths.includes(location.pathname.replace(/\/$/, ''))) return;

    let run: Run | undefined;
    let backgroundRequestAt: number | undefined;
    let clicked = false;
    let muted: boolean | null = null;
    let mutePending = false;
    let muteRevision = 0;
    const mutedForAutoplay = new WeakMap<HTMLVideoElement, Playing>();
    const panel = mountPanel(document, () => {
      clicked = true;
      if (run) stop('已暂停。点「开始」可以继续。', true);
      else start();
    }, () => {
      if (muted === null || mutePending) return;
      mutePending = true;
      const revision = muteRevision;
      panel.updateMute(muted, true);
      void send({ kind: 'toggle-muted' }).then((value) => {
        mutePending = false;
        if (muteRevision === revision) muted = value ?? muted;
        panel.updateMute(muted);
      });
    }, () => {
      const playing = run?.playing;
      if (!playing || playing.video.paused || playing.video.ended) return;
      restoreVideoSound(playing);
      showPlaying(playing);
      if (muted) setStatus('视频声音已开启。当前标签页静音中。');
    });
    const syncMute = (message: TabMutedUpdate) => {
      if (message?.kind !== 'tab-muted-changed' || typeof message.muted !== 'boolean') return;
      muteRevision++;
      muted = message.muted;
      panel.updateMute(muted, mutePending);
    };
    browser.runtime.onMessage.addListener(syncMute);
    const initialRevision = muteRevision;
    void send({ kind: 'get-muted' }).then((value) => {
      if (muteRevision !== initialRevision) return;
      muted = value;
      panel.updateMute(muted);
    });
    setStatus('在当前小节开始续学。');

    function setStatus(message: string) {
      panel.update(chapterTitle(document), message, !!run);
    }

    // Keep the review list in this course tab across full-page chapter navigation.
    const reviewKey = 'course-queue:review:' + getCoursePage(new URL(location.href))?.course;
    let pendingReview: { id: string; title: string; items: string[] }[] = [];
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(reviewKey) ?? '[]');
      if (Array.isArray(saved)) pendingReview = saved.filter(item => typeof item?.id === 'string' && typeof item.title === 'string'
        && Array.isArray(item.items) && item.items.every((label: unknown) => typeof label === 'string'));
    } catch { /* Storage can be unavailable in restricted browser sessions. */ }

    function saveReview() {
      try {
        if (pendingReview.length) sessionStorage.setItem(reviewKey, JSON.stringify(pendingReview));
        else sessionStorage.removeItem(reviewKey);
      } catch { /* Same-page navigation still retains the in-memory list. */ }
    }

    function rememberPending(active: Run, lesson: Extract<Lesson, { kind: 'tasks' }>, tab?: Element) {
      const prefix = tab?.textContent?.trim();
      const pending: string[] = [];
      const confirmed = new Set<string>();
      for (const [kind, tasks] of [['视频', lesson.videos], ['资料', lesson.readings]] as const) {
        tasks.forEach(({ task }, index) => {
          if (!task) return;
          const label = (prefix ? prefix + '·' : '') + kind + (index + 1);
          if (completed(task)) confirmed.add(label);
          else pending.push(label);
        });
      }
      const title = chapterTitle(document);
      const entry = pendingReview.find(item => item.id === active.chapterId && item.title === title);
      const items = [...new Set([...(entry?.items ?? []).filter(item => !confirmed.has(item)), ...pending])];
      if (!items.length && chapterCompletion(document) !== 'pending') {
        if (!entry) return;
        pendingReview = pendingReview.filter(item => item !== entry);
      } else if (entry) {
        entry.items = items;
      } else {
        pendingReview.push({ id: active.chapterId, title, items });
      }
      saveReview();
    }

    function reviewSummary(message: string) {
      const page = getCoursePage(new URL(location.href));
      pendingReview = pendingReview.filter(({ id }) => {
        const row = page && catalogChapterById(document, page, id)?.row;
        return !row || chapterCompletion(document, row) !== 'complete';
      });
      saveReview();
      return pendingReview.length ? message + ' 待核对小节：' + pendingReview.map(item => item.items.length
        ? item.title + '（' + item.items.join('、') + '）' : item.title).join('、') + '。' : message;
    }

    function start() {
      run = {
        deadline: Date.now() + loadWait,
        chapter: currentChapter(document),
        chapterId: currentChapterId(document),
        endedVideos: new Map(),
        verifiedCards: new Set(),
        readerBottoms: new Map(),
      };
      setStatus('正在查找当前页的课程任务…');
      tick();
      scheduleBackgroundStep();
    }

    function stop(message: string, pauseVideo = false) {
      const previous = run;
      run = undefined;
      previous?.playing?.listeners.abort();
      const transition = previous?.switching;
      if (transition?.kind === 'chapter' && transition.id) {
        void send({ kind: 'cancel-next', id: transition.id });
      }
      if (pauseVideo) previous?.playing?.video.pause();
      panel.updateVideoSound(false);
      setStatus(message);
    }

    function restoreVideoSound(playing: Playing) {
      const { video } = playing;
      if (mutedForAutoplay.get(video) !== playing) return;
      mutedForAutoplay.delete(video);
      video.muted = false;
    }

    function showPlaying(playing: Playing) {
      const { video, label } = playing;
      const silent = video.muted && mutedForAutoplay.has(video);
      panel.updateVideoSound(silent);
      setStatus(silent ? label + '已静音续播。' : label === '视频' ? '正在播放。' : '正在播放' + label + '。');
    }

    async function startVideo(active: Run, playing: Playing) {
      const { video, label } = playing;
      const pending = () => run === active && active.playing === playing && video.isConnected && !playing.started && !video.ended;
      if (playing.attempting || !pending() || Date.now() < playing.retryAt) return;
      playing.attempting = true;
      try {
        const player = video.closest('.video-js');
        const control = player?.querySelector<HTMLElement>('.vjs-big-play-button');
        if (!playing.clickedControl && player?.querySelectorAll('video').length === 1 && control?.getClientRects().length) {
          playing.clickedControl = true;
          control.click();
          return;
        }
        try {
          await video.play();
        } catch (error) {
          if (!pending() || !video.paused) return;
          if (!autoplayBlocked(error) || video.muted) throw error;
          mutedForAutoplay.set(video, playing);
          video.muted = true;
          await video.play();
        }
      } catch (error) {
        if (!pending()) return;
        playing.lastError = error && typeof error === 'object' && 'name' in error ? String(error.name) : '播放失败';
        setStatus(label + '尚未启动（' + playing.lastError + '），正在等待播放器重试…');
      } finally {
        playing.attempting = false;
        playing.retryAt = Date.now() + (Date.now() >= playing.deadline ? 15_000 : 1500);
      }
    }

    function bind(active: Run, video: HTMLVideoElement, label: string) {
      const playing: Playing = {
        video, label, listeners: new AbortController(), started: !video.paused && video.readyState >= 3,
        attempting: false, retryAt: 0, deadline: Date.now() + 45_000, clickedControl: false,
      };
      active.playing = playing;
      if (mutedForAutoplay.has(video)) mutedForAutoplay.set(video, playing);
      const options = { signal: playing.listeners.signal };
      video.addEventListener('playing', () => {
        playing.started = true;
        playing.endedAt = undefined;
        showPlaying(playing);
      }, options);
      video.addEventListener('volumechange', () => {
        if (!video.muted && mutedForAutoplay.delete(video) && !video.paused && !video.ended) {
          showPlaying(playing);
        }
      }, options);
      video.addEventListener('pause', () => {
        if (playing.started && !video.ended && video.isConnected && video.paused) stop('播放器已暂停。点「开始」可以继续。');
      }, options);
      video.addEventListener('ended', () => {
        if (video.ended) markEnded(playing);
      }, options);
      video.addEventListener('error', () => {
        if (playing.started) stop('视频播放中断。请查看学习通播放器提示。');
        else playing.lastError = '媒体错误 ' + (video.error?.code ?? '');
      }, options);

      if (video.ended) {
        markEnded(playing);
      } else if (playing.started) {
        showPlaying(playing);
      } else {
        setStatus('正在启动' + label + '…');
        void startVideo(active, playing);
      }
    }

    function markEnded(playing: Playing) {
      if (playing.endedAt) return;
      playing.endedAt = Date.now();
      restoreVideoSound(playing);
      panel.updateVideoSound(false);
      setStatus(playing.label + '已播完，正在检查下一项…');
      scheduleBackgroundStep();
    }

    function readingProgress(reading: Reading, result: ScrollResult) {
      const active = run;
      if (!active || active.reading !== reading) return;
      if (result === 'moving') {
        reading.lastMoved = Date.now();
        if (reading.bottomAt) setStatus('正在滚动' + reading.label + '…');
        reading.bottomAt = undefined;
      } else if (result === 'bottom') {
        if (reading.bottomAt === undefined) setStatus(reading.label + '已滚动到底，正在检查是否还有内容…');
        reading.lastBottomAt = Date.now();
        reading.bottomAt ??= reading.lastBottomAt;
      } else {
        reading.bottomAt = undefined;
      }
    }

    ctx.addEventListener(window, 'message', (event) => {
      const reading = run?.reading;
      if (!reading?.target || event.source !== reading.target || event.origin !== readerOrigin) return;
      const { kind, id, sequence, result } = event.data ?? {};
      if (kind === readerProgress && id === reading.id && Number.isSafeInteger(sequence)
        && sequence > (reading.receivedSequence ?? 0) && sequence <= (reading.sentSequence ?? 0)
        && ['loading', 'moving', 'bottom'].includes(result)) {
        reading.receivedSequence = sequence;
        if (sequence === reading.sentSequence) reading.sentAt = undefined;
        readingProgress(reading, result);
      }
    });

    function read(active: Run, frame: HTMLIFrameElement, label: string) {
      if (active.reading?.frame !== frame || active.reading.source !== frame.src) {
        active.reading = { frame, source: frame.src, label, id: crypto.randomUUID(), lastMoved: Date.now() };
        frame.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        setStatus('正在滚动' + label + '…');
      }
      const reading = active.reading;
      if (reading.bottomAt !== undefined && reading.lastBottomAt !== undefined && reading.lastBottomAt - reading.bottomAt >= readerSettle) {
        active.readerBottoms.set(frame, reading.source);
        active.reading = undefined;
        return;
      }
      stepReader(reading);
      if (reading.bottomAt === undefined && Date.now() - reading.lastMoved >= loadWait) {
        if (Date.now() - reading.lastMoved >= 60_000) {
          stop('未收到' + label + '的有效滚动进度，请打开阅读器查看。');
        } else if (document.hidden) {
          setStatus('后台正在等待' + label + '的阅读器加载或返回滚动进度…');
        } else if (reading.sentAt === undefined) {
          stop('暂时无法滚动' + label + '，请在阅读器内手动滚动。');
        }
      }
    }

    function stepReader(reading: Reading) {
      const reader = locateReader(reading.frame);
      if (reader && 'doc' in reader) readingProgress(reading, scrollReader(reader.doc));
      if (reader && 'frame' in reader) {
        if (reading.target === reader.frame && reading.sentAt !== undefined && Date.now() - reading.sentAt < readerReplyWait) return;
        reading.sentAt = Date.now();
        reading.target = reader.frame;
        reading.sentSequence = (reading.sentSequence ?? 0) + 1;
        reader.frame.postMessage({ kind: readerStep, id: reading.id, sequence: reading.sentSequence }, readerOrigin);
      }
    }

    function scanBelow(active: Run, content: Document): boolean {
      if (active.scanStartedAt === undefined) {
        const blocks = [...content.body.children].filter((node) => node.getClientRects().length > 0);
        (blocks.at(-1) ?? content.body).scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
        active.scanStartedAt = Date.now();
        setStatus('正在检查本页下方是否还有资料…');
      }
      return Date.now() - active.scanStartedAt >= readerSettle;
    }

    function isCurrentChapter(active: Run): boolean {
      return !active.chapter || currentChapter(document) === active.chapter
        || (!!active.chapterId && currentChapterId(document) === active.chapterId);
    }

    async function advance(active: Run, page: CoursePage, next: NextChapter, from: CardLocation, skipCurrent: boolean) {
      const id = next.chapter ? crypto.randomUUID() : undefined;
      const deadline = Date.now() + transitionLifetime;
      active.switching = { kind: 'chapter', id, next, from, deadline };
      const skipped = next.skipped + (skipCurrent ? 1 : 0);
      setStatus(skipped
        ? '正在略过 ' + skipped + ' 个非视频/教材小节并打开后续课程…'
        : '本节内容已处理，正在打开下一节…');
      if (id) {
        await send({
          kind: 'expect-next',
          transition: { id, course: page.course, chapter: next.chapter, expiresAt: deadline },
        });
      }
      if (run !== active) {
        if (id) void send({ kind: 'cancel-next', id });
        return;
      }
      const currentNext = findNextChapter(document, page);
      if (currentNext === 'locked') {
        stop(chapterStopMessages.locked);
        return;
      }
      const currentTabs = readTaskCards(document);
      const currentLesson = inspectLesson(document);
      const ready = skipCurrent
        ? currentLesson.kind === 'skip' && !currentTabs
        : tasksReady(currentLesson, active.readerBottoms, active.endedVideos)
          && !currentTabs?.cards.some((_, index) => !active.verifiedCards.has(index));
      if (typeof currentNext === 'string' || currentNext.control !== next.control
        || currentNext.chapter !== next.chapter || !isCurrentChapter(active)
        || chapterContent(document) !== from.content
        || currentTabs?.index !== from.index || !ready) {
        stop('页面状态已变化，请查看当前小节。');
        return;
      }
      next.control.click();
    }

    function openNextChapter(active: Run, card: CardLocation, skipCurrent = false) {
      const page = getCoursePage(new URL(location.href));
      const next = page ? findNextChapter(document, page) : 'manual';
      if (!page || typeof next === 'string') {
        stop(reviewSummary(chapterStopMessages[typeof next === 'string' ? next : 'manual']));
        return;
      }
      void advance(active, page, next, card, skipCurrent);
    }

    function openCard(active: Run, card: CardLocation, control: HTMLElement, index: number, message: string) {
      active.switching = { kind: 'card', index, from: card, deadline: Date.now() + cardSwitchWait };
      setStatus(message + '，正在打开「' + control.textContent?.trim() + '」…');
      control.click();
    }

    function finishCard(active: Run, card: CardLocation, tabs: ReturnType<typeof readTaskCards>) {
      if (tabs) {
        if (tabs.index < 0) {
          stop('无法确认当前教材或视频页签，请在学习通选择后再开始。');
          return;
        }
        active.verifiedCards.add(tabs.index);
        const unvisited = tabs.cards.map((control, index) => ({ control, index }))
          .filter(({ index }) => !active.verifiedCards.has(index));
        const recognized = unvisited.filter(({ control }) => taskCardKind(control) && canOpenTaskCard(control));
        const remaining = recognized.length ? recognized : unvisited;
        const nextCard = remaining.find(({ index }) => index > tabs.index) ?? remaining[0];
        if (nextCard) {
          if (!canOpenTaskCard(nextCard.control)) {
            stop('请在学习通手动查看「' + nextCard.control.textContent?.trim() + '」页签。');
            return;
          }
          openCard(active, card, nextCard.control, nextCard.index, '本页内容已处理');
          return;
        }
      }
      openNextChapter(active, card);
    }

    function tick() {
      const active = run;
      if (!active) return;
      const lesson = inspectLesson(document);
      if (lesson.kind === 'manual') {
        stop(lesson.message, true);
        return;
      }
      const content = chapterContent(document);
      const tabs = readTaskCards(document, content);
      const card = content ? locationOf(lesson, content, tabs?.index) : undefined;
      const switching = active.switching;
      if (switching) {
        if (switching.kind === 'card' && !isCurrentChapter(active)) {
          stop('小节已切换。请在当前页重新开始。');
          return;
        }
        const changed = card && (card.content !== switching.from.content
          || (card.firstTask && card.firstTask !== switching.from.firstTask));
        if (switching.kind === 'chapter' && changed && (currentChapter(document) === switching.next.row
          || (switching.next.chapter && currentChapterId(document) === switching.next.chapter))) {
          if (switching.id) void send({ kind: 'cancel-next', id: switching.id });
          start();
        } else if (switching.kind === 'card' && changed && card.index === switching.index && lesson.kind !== 'loading') {
          active.switching = undefined;
          active.card = undefined;
          active.readerBottoms.clear();
          active.scanStartedAt = undefined;
          active.checkingReaders = false;
          active.endedVideos.clear();
          active.deadline = Date.now() + loadWait;
          tick();
        } else if (Date.now() >= switching.deadline) {
          stop(switching.kind === 'chapter' ? '未能确认下一节已打开，请查看学习通目录。' : '未能确认新页签已加载，请在学习通打开后再开始。');
        }
        return;
      }

      if (!isCurrentChapter(active) || (active.card && (!card || card.content !== active.card.content
        || (active.card.index !== undefined && active.card.index >= 0 && card.index !== active.card.index)))) {
        stop('小节或页签已切换。请在当前页重新开始。');
        return;
      }
      if (card && lesson.kind === 'skip') {
        if (tabs) stop('此页签含答题任务，请回到本节的视频或教材页。');
        else openNextChapter(active, card, true);
        return;
      }
      if (!card || lesson.kind !== 'tasks') {
        if (Date.now() >= active.deadline) stop(lesson.kind === 'loading' ? lesson.message : '当前课程仍在加载。');
        return;
      }
      const tab = tabs?.cards[tabs.index];
      const cardKind = taskCardKind(tab);
      const wrongContent = (cardKind === 'reading' && !lesson.readings.length && lesson.videos.length)
        || (cardKind === 'video' && !lesson.videos.length && lesson.readings.length);
      if (wrongContent) {
        const label = tab?.textContent?.trim();
        if (Date.now() >= active.deadline) stop('未能读取「' + label + '」的任务，请在学习通重新打开该页签。');
        else setStatus('正在等待「' + label + '」的内容加载…');
        return;
      }
      active.card = card;
      const playing = lesson.videos.filter(({ video }) => video && !video.paused && !video.ended);
      let current = active.playing;
      const boundVideo = current?.video;
      if (current && !current.started && !lesson.videos.some(({ video }) => video === boundVideo)) {
        current.listeners.abort();
        restoreVideoSound(current);
        active.playing = current = undefined;
        active.deadline = Date.now() + loadWait;
      }
      if (playing.length > 1 || (current && !current.video.ended && playing.some(({ video }) => video !== current.video))) {
        stop('检测到多个视频同时播放，请暂停其他视频后再开始。');
        return;
      }
      if (current) {
        const task = lesson.videos.find(({ video }) => video === current.video);
        if (!task) {
          stop('播放器已切换，请在当前页重新开始。');
          return;
        }
        if (current.video.ended) markEnded(current);
        if (!current.endedAt) {
          if (!current.started) {
            if (Date.now() >= current.deadline) {
              const reason = current.lastError ?? '未收到播放事件';
              setStatus(current.label + '仍未开始（' + reason + '），继续等待。也可点击播放器中央的播放键接续。');
            }
            if (current.video.paused) void startVideo(active, current);
          }
          return;
        }
        active.endedVideos.set(current.video, current.video.currentSrc || current.video.src);
        current.listeners.abort();
        active.playing = undefined;
        active.deadline = Date.now() + loadWait;
      }
      const next = playing[0] ?? lesson.videos.find(({ task, video }) => !completed(task)
        && (!video || active.endedVideos.get(video) !== (video.currentSrc || video.src)));
      if (next) {
        active.reading = undefined;
        const label = lesson.videos.length > 1 ? '第 ' + (lesson.videos.indexOf(next) + 1) + '/' + lesson.videos.length + ' 条视频' : '视频';
        if (next.video) bind(active, next.video, label);
        else if (Date.now() >= active.deadline) stop('无法读取' + label + '的播放器，请在学习通手动播放。');
        else setStatus('正在等待' + label + '加载…');
        return;
      }
      const readingLabel = (frame: HTMLIFrameElement) => lesson.readings.length > 1
        ? '第 ' + (lesson.readings.findIndex((reading) => reading.frame === frame) + 1) + '/' + lesson.readings.length + ' 份资料'
        : '教材';
      const reading = lesson.readings.find(({ frame, task }) => !completed(task) && active.readerBottoms.get(frame) !== frame.src);
      if (reading) {
        read(active, reading.frame, readingLabel(reading.frame));
        return;
      }
      if ((lesson.readings.length || cardKind === 'reading') && !scanBelow(active, card.content)) return;
      if (active.readerBottoms.size && !active.checkingReaders) {
        // Lazy-loaded pages may extend an earlier reader while later readers scroll.
        active.checkingReaders = true;
        active.readerBottoms.clear();
        return;
      }
      if (!tasksReady(lesson, active.readerBottoms, active.endedVideos)) {
        stop('本页还有其他任务，请在学习通查看。');
        return;
      }
      rememberPending(active, lesson, tab);
      finishCard(active, card, tabs);
    }

    function needsBackgroundStep() {
      const playing = run?.playing;
      return ctx.isValid && !!run && document.hidden && !(playing?.started && !playing.endedAt && !playing.video.ended);
    }

    function scheduleBackgroundStep() {
      if (backgroundRequestAt !== undefined || !needsBackgroundStep()) return;
      backgroundRequestAt = Date.now();
      void send({ kind: 'next-background-step' }).then((ready) => {
        backgroundRequestAt = undefined;
        if (!ready || !needsBackgroundStep()) return;
        tick();
        scheduleBackgroundStep();
      });
    }

    function resumePage() {
      if (!run) return;
      if (run.reading) run.reading.lastMoved = Date.now();
      tick();
      scheduleBackgroundStep();
    }
    ctx.addEventListener(document, 'visibilitychange', resumePage);
    ctx.addEventListener(document, 'resume', resumePage);
    ctx.setInterval(() => {
      // The page timer remains a fallback if the worker is restarted or a reply is delayed.
      if (document.hidden && backgroundRequestAt !== undefined && Date.now() - backgroundRequestAt < 3000) return;
      tick();
      scheduleBackgroundStep();
    }, 450);
    ctx.onInvalidated(() => {
      run?.playing?.listeners.abort();
      browser.runtime.onMessage.removeListener(syncMute);
      panel.remove();
    });
    void send({ kind: 'take-next' }).then((resume) => {
      if (resume === true && !clicked && ctx.isValid) start();
    });
  },
});
