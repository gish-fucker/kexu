import { documentFrames } from './reader';

export const studyPaths = [
  '/mooc-ans/mycourse/studentstudy',
  '/mooc2-ans/mycourse/studentstudy',
  '/mycourse/studentstudy',
];

export interface CoursePage {
  course: string;
  chapter: string;
}

function queryId(url: URL, name: string): string {
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === name && /^\d+$/.test(value)) return value;
  }
  return '';
}

export function getCoursePage(url: URL): CoursePage | undefined {
  if (!studyPaths.includes(url.pathname.replace(/\/$/, ''))) return;
  const courseId = queryId(url, 'courseid');
  const classId = queryId(url, 'clazzid');
  const chapter = queryId(url, 'chapterid');
  if (courseId && classId) {
    return { course: JSON.stringify([url.origin, courseId, classId]), chapter };
  }
}

export function isShown(node: Element): boolean {
  return isVisible(node, false);
}

function isVisible(node: Element, includeDecorative: boolean): boolean {
  const view = node.ownerDocument.defaultView;
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    if (parent.hasAttribute('hidden') || (!includeDecorative && parent.getAttribute('aria-hidden') === 'true')) return false;
    const style = view?.getComputedStyle(parent);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function frameDocument(frame: HTMLIFrameElement): Document | null {
  const doc = frame.contentDocument;
  return doc?.URL === 'about:blank' && !!frame.getAttribute('src') ? null : doc;
}

const playerSelector = 'iframe.ans-insertvideo-online, iframe[src*="/ananas/modules/video/"]';
const quizSelector = 'iframe[src*="/work/"], form[action*="/work/"], .Zy_TItle';
const videoQuestionSelector = '.vjs-quiz, .videoquiz';
const taskContainer = '.ans-attach-ct, .ans-job-finished';

export function completed(task: Element | null): boolean {
  if (!task) return false;
  const icon = task.matches('.ans-job-icon') ? task : task.querySelector('.ans-job-icon');
  const finished = icon?.closest('.ans-job-finished');
  return task.classList.contains('ans-job-finished')
    || (!!finished && finished.querySelectorAll('.ans-job-icon').length === 1)
    || [icon?.getAttribute('aria-label'), icon?.getAttribute('title'), icon?.textContent]
      .some((label) => label?.trim() === '任务点已完成');
}

interface VideoTask {
  video: HTMLVideoElement | null;
  task: Element | null;
}

interface ReadingTask {
  frame: HTMLIFrameElement;
  task: Element | null;
}

function readingTasks(content: Document): ReadingTask[] {
  const readings: ReadingTask[] = [];
  let marker: Element | undefined;
  for (const node of content.querySelectorAll('.ans-job-icon, video, ' + playerSelector + ', ' + documentFrames)) {
    if (!isShown(node)) continue;
    if (node.matches('.ans-job-icon')) {
      marker = node;
      continue;
    }
    if (node.matches(documentFrames)) {
      const container = node.closest(taskContainer);
      const withinTask = marker && (container?.contains(marker) || marker.parentElement === node.parentElement
        || marker.nextElementSibling === container || marker.parentElement?.nextElementSibling === container);
      // A wrapper can contain several viewers and markers. Each marker belongs to one viewer.
      const single = container?.querySelectorAll(documentFrames).length === 1;
      const localMarker = single ? container?.querySelector('.ans-job-icon') : null;
      const task = (withinTask ? marker : localMarker) ?? (single && container?.matches('.ans-job-finished') ? container : null);
      readings.push({ frame: node as HTMLIFrameElement, task });
    }
    marker = undefined;
  }
  return readings;
}

interface AvailableLesson {
  kind: 'tasks';
  videos: VideoTask[];
  readings: ReadingTask[];
  pendingOtherTask: boolean;
  firstTask?: Element;
}

interface UnavailableLesson {
  kind: 'loading' | 'manual';
  message: string;
}

interface SkippableLesson {
  kind: 'skip';
  firstTask?: Element;
}

export type Lesson = AvailableLesson | UnavailableLesson | SkippableLesson;

export function inspectLesson(doc: Document): Lesson {
  if ([...doc.querySelectorAll('.jobFinishTip, form[action*="/login"]')].some(isShown)) {
    return { kind: 'manual', message: '课程页面需要处理。请查看网页提示后再开始。' };
  }

  const content = chapterContent(doc);
  if (!content) return { kind: 'loading', message: '暂时无法读取课程内容，请查看当前页签。' };

  const nodes = [...content.querySelectorAll<HTMLVideoElement | HTMLIFrameElement>('video, ' + playerSelector)].filter(isShown);
  const videos: VideoTask[] = [];
  const knownTasks = new Set<Element>();
  for (const node of nodes) {
    const task = node.closest(taskContainer);
    const player = node.tagName === 'IFRAME' ? frameDocument(node as HTMLIFrameElement) : content;
    const media = node.tagName === 'VIDEO' ? [node as HTMLVideoElement] : [...(player?.querySelectorAll('video') ?? [])].filter(isShown);
    if (media.length > 1 || (task && knownTasks.has(task))) {
      return { kind: 'manual', message: '同一个任务点有多个播放器，请在学习通选择并播放。' };
    }
    if (task) knownTasks.add(task);
    videos.push({ video: media[0] ?? null, task });
  }
  const inVideo = [...content.querySelectorAll(videoQuestionSelector)].some(isShown)
    || videos.some(({ video }) => video && video.ownerDocument !== content
      && [...video.ownerDocument.querySelectorAll(quizSelector + ', ' + videoQuestionSelector)].some(isShown));
  if (inVideo) {
    return { kind: 'manual', message: '遇到视频互动题，请在学习通处理后再继续。' };
  }

  const readings = readingTasks(content);
  const quiz = [...content.querySelectorAll(quizSelector)].find(isShown);
  if (!videos.length && !readings.length && (quiz || isNonTargetTitle(chapterTitle(doc)))) {
    return { kind: 'skip', firstTask: quiz };
  }
  if (quiz) {
    return { kind: 'manual', message: '此页混有课程内容和答题任务，请在学习通查看。' };
  }
  const markers = [...content.querySelectorAll('.ans-job-icon')].filter(isShown);
  const covered = new Set([
    ...videos.map(({ task }) => task?.querySelector('.ans-job-icon')),
    ...readings.map(({ task }) => task),
  ]);
  const pendingOtherTask = markers.some((marker) => !covered.has(marker) && !completed(marker));
  const attachment = [...content.querySelectorAll(taskContainer)].find(isShown);
  if (!videos.length && !readings.length && !pendingOtherTask
    && !markers.some(completed) && ![...content.querySelectorAll('.ans-job-finished')].some(isShown)) {
    return { kind: 'loading', message: '此页未发现可续播的视频或教材，请查看学习通页面。' };
  }
  return {
    kind: 'tasks', videos, readings, pendingOtherTask,
    firstTask: attachment ?? markers[0] ?? videos[0]?.video ?? readings[0]?.frame,
  };
}

export function tasksReady(
  lesson: Lesson,
  readerBottoms: ReadonlyMap<HTMLIFrameElement, string>,
  endedVideos: ReadonlyMap<HTMLVideoElement, string>,
): boolean {
  return lesson.kind === 'tasks' && !lesson.pendingOtherTask
    && lesson.videos.every(({ task, video }) => completed(task)
      || (!!video && endedVideos.get(video) === (video.currentSrc || video.src)))
    && lesson.readings.every(({ frame, task }) => completed(task) || readerBottoms.get(frame) === frame.src);
}

export function taskCardKind(control: Element | undefined): 'video' | 'reading' | undefined {
  const label = control?.textContent?.replace(/\s+/g, '').replace(/^\d+[.、)）]?/, '');
  if (label === '视频' || label === '慕课视频') return 'video';
  if (/^教材[+＋]PPT$/i.test(label ?? '')) return 'reading';
}

const cardGroups = '.ncells, .tabtags, .tabs, [role="tablist"]';
const explicitTabs = 'a, button, [role="tab"], span[onclick], li[onclick], div[onclick]';
const activeTab = '.currents, .current, .cur, .selected, .active, [aria-selected="true"], [aria-current="page"], [data-state="active"]';

function hasVideoAndReading(cards: Element[]): boolean {
  return cards.some((card) => taskCardKind(card) === 'video')
    && cards.some((card) => taskCardKind(card) === 'reading');
}

function controlsIn(bar: Element): HTMLElement[] {
  const controls = [...bar.querySelectorAll<HTMLElement>(explicitTabs + ', :scope > span, :scope > li, :scope > ul > li')]
    .filter((card) => !!card.textContent?.trim() && isShown(card));
  return controls.filter((card) => !controls.some((other) => other !== card && card.contains(other)));
}

function findTaskCards(doc: Document) {
  let fallback: { bar: Element; cards: HTMLElement[] } | undefined;
  for (const bar of doc.querySelectorAll(cardGroups)) {
    const cards = controlsIn(bar);
    if (cards.length > 1 && cards.some((card) => /视频|教材|PPT|课件|文档|测验/i.test(card.textContent ?? ''))) {
      if (hasVideoAndReading(cards)) {
        // A layout wrapper can include buttons outside the actual tab strip.
        const video = cards.find(card => taskCardKind(card) === 'video')!;
        for (let strip = video.parentElement; strip && strip !== bar; strip = strip.parentElement) {
          const siblings = cards.filter(card => strip!.contains(card));
          if (hasVideoAndReading(siblings)) return { bar: strip, cards: siblings };
        }
        return { bar, cards };
      }
      fallback ??= { bar, cards };
    }
  }
  // Some course layouts use sibling labels without a tablist class.
  for (const node of doc.querySelectorAll<HTMLElement>(explicitTabs + ', span, li')) {
    if (taskCardKind(node) !== 'video' || !isShown(node)) continue;
    for (const bar of [node.parentElement, node.parentElement?.parentElement]) {
      if (!bar || bar.matches('body, html')) continue;
      const cards = controlsIn(bar);
      if (hasVideoAndReading(cards)) return { bar, cards };
    }
  }
  return fallback;
}

export function readTaskCards(doc: Document, content = chapterContent(doc)) {
  const outer = findTaskCards(doc);
  const inner = content && content !== doc && (!outer || !hasVideoAndReading(outer.cards)) ? findTaskCards(content) : undefined;
  const group = inner && hasVideoAndReading(inner.cards) ? inner : outer ?? inner;
  if (!group) return;
  const { bar, cards } = group;
  const selected = cards.filter((card) => {
    const marker = card.closest(activeTab);
    return marker !== null && marker !== bar && bar.contains(marker);
  });
  if (selected.length === 1 && selected[0]) return { cards, index: cards.indexOf(selected[0]) };

  const url = content ? new URL(content.URL) : undefined;
  const num = url?.searchParams.get('num') ?? '';
  const index = url?.pathname.endsWith('/knowledge/cards') && /^\d+$/.test(num) ? Number(num) : -1;
  return { cards, index: !selected.length && cards[index] ? index : -1 };
}

export function canOpenTaskCard(control: HTMLElement): boolean {
  const name = control.textContent ?? '';
  const href = control.closest('a[href]')?.getAttribute('href')?.trim();
  return /视频|教材|PPT|课件|文档|讲义|阅读|PDF/i.test(name)
    && !/测验|考试|签到|讨论|未开放|未解锁/.test(name)
    && !control.closest('[disabled], [aria-disabled="true"], .lock, .locked')
    && (!href || href === '#' || /^javascript:\s*(?:void\s*\(\s*0\s*\)\s*;?|;?|(?:return\s+)?[\w$]+\([^;]*\);?)$/i.test(href));
}

interface Catalog {
  rows: HTMLElement[];
  current: HTMLElement | undefined;
}

function readCatalog(doc: Document): Catalog {
  const rows = [...doc.querySelectorAll<HTMLElement>('#coursetree .posCatalog_select:not(.firstLayer)')];
  const active = rows.filter((row) => row.matches('.posCatalog_active, [aria-current="true"], [aria-current="page"]'));
  return { rows, current: active.length === 1 ? active[0] : undefined };
}

export function currentChapter(doc: Document): Element | undefined {
  return readCatalog(doc).current;
}

export function chapterCompletion(doc: Document, row = currentChapter(doc)): 'pending' | 'complete' | 'unknown' {
  if (!row) return 'unknown';
  const belongsToRow = (marker: Element) => marker.closest('.posCatalog_select') === row && isVisible(marker, true);
  const counters = row.querySelectorAll('.catalog_points_yi, .jobCount, .jobUnfinishCount');
  if ([...counters].some((counter) => belongsToRow(counter) && Number(counter.textContent?.trim()) > 0)) {
    return 'pending';
  }
  const markers = row.querySelectorAll('.icon_Completed, [aria-label], [title], img[alt], svg use');
  const confirmed = [...markers].some((marker) => {
    if (!belongsToRow(marker) || marker.matches('.posCatalog_name')) return false;
    if (marker.classList.contains('icon_Completed')) return true;
    const symbol = marker.getAttribute('href') ?? marker.getAttribute('xlink:href');
    if (marker.localName === 'use' && symbol?.split('#')[1] === 'icon_Completed') return true;
    return ['aria-label', 'title', 'alt'].some((attr) =>
      /^(?:(?:本小节|本节|章节|全部)?任务点)?已(?:全部)?完成$/.test(marker.getAttribute(attr)?.trim() ?? ''));
  });
  return confirmed ? 'complete' : 'unknown';
}

export function currentChapterId(doc: Document): string {
  const field = doc.querySelector<HTMLInputElement>('#curChapterId');
  return field?.value || getCoursePage(new URL(doc.URL))?.chapter || '';
}

export function chapterContent(doc: Document): Document | null {
  const cards = doc.querySelector<HTMLIFrameElement>('iframe#iframe')
    ?? doc.querySelector<HTMLIFrameElement>('iframe[src*="/knowledge/cards"]');
  return cards ? frameDocument(cards) : doc;
}

function chapterId(row: Element): string {
  const id = row.getAttribute('data-chapterid') ?? row.getAttribute('data-knowledgeid') ?? '';
  return /^\d+$/.test(id) ? id : '';
}

export function chapterTitle(doc: Document): string {
  const title = currentChapter(doc)?.querySelector('.posCatalog_name');
  return title?.getAttribute('title')?.trim() || title?.textContent?.trim() || '当前小节';
}

function isNonTargetTitle(text: string): boolean {
  const name = text.replace(/\s+/g, '').replace(/^\d+(?:[.．-]\d+)*[.、)）]?/, '');
  return /^(?:章节(?:图谱|讨论|测验|测试|练习|作业|答题)|知识图谱|课程讨论|随堂(?:测验|测试|练习)|课后(?:练习|作业)|答题)$/.test(name);
}

export interface NextChapter {
  row: HTMLElement;
  control: HTMLElement;
  chapter: string;
  skipped: number;
}

export function catalogChapterById(doc: Document, page: CoursePage, id: string): NextChapter | undefined {
  if (!/^\d+$/.test(id)) return;
  for (const row of readCatalog(doc).rows) {
    const control = row.querySelector<HTMLElement>('.posCatalog_name, a[href], button');
    if (!control || !isShown(control) || row.matches('[aria-disabled="true"], .locked, .lock')
      || control.matches(':disabled, [aria-disabled="true"]')
      || [...row.querySelectorAll('.lock, .locked, .catalog_lock, .posCatalog_lock')].some(isShown)) continue;
    const link = chapterLink(doc, page, row, control);
    if (link?.chapter === id) return { ...link, row, skipped: 0 };
  }
}

export function findNextChapter(
  doc: Document,
  page: CoursePage,
): NextChapter | 'last' | 'locked' | 'manual' {
  const { rows, current } = readCatalog(doc);
  if (!current) return 'manual';
  const blocked = '[disabled], [aria-disabled="true"], .lock, .locked, .posCatalog_lock, .catalog_lock';
  const currentIndex = rows.indexOf(current);
  let skipped = 0;
  for (const row of rows.slice(currentIndex + 1)) {
    const control = row.querySelector<HTMLElement>('.posCatalog_name, a[href], button');
    const title = control?.getAttribute('title') ?? '';
    const text = control?.textContent ?? '';
    if (row.matches(blocked) || control?.closest(blocked)
      || [...row.querySelectorAll(blocked)].some(isShown)
      || /未开放|未解锁|已锁定/.test(title + ' ' + text)) return 'locked';
    if (!control || !isShown(control)) return 'manual';
    if (isNonTargetTitle(title) || isNonTargetTitle(text)) {
      skipped++;
      continue;
    }
    const target = chapterLink(doc, page, row, control);
    if (!target || (target.chapter && (target.chapter === currentChapterId(doc)
      || rows.slice(0, currentIndex).some((previous) => chapterId(previous) === target.chapter)))) return 'manual';
    return { row, ...target, skipped };
  }
  return 'last';
}

function chapterLink(doc: Document, page: CoursePage, row: Element, control: HTMLElement) {
  let chapter = chapterId(row);
  const anchor = control.closest<HTMLAnchorElement>('a[href]') ?? control.querySelector<HTMLAnchorElement>('a[href]');
  const href = anchor?.getAttribute('href')?.trim();
  if (anchor?.hasAttribute('download') || (anchor?.getAttribute('target') && anchor.getAttribute('target') !== '_self')) return;
  const handler = href?.startsWith('javascript:') && /getTeacherAjax\(/.test(href) ? href : control.getAttribute('onclick') ?? '';
  const args = handler.match(/^(?:javascript:\s*|return\s+)?getTeacherAjax\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)\s*;?$/i);
  if (args) {
    if (JSON.stringify([new URL(doc.URL).origin, args[1], args[2]]) !== page.course) return;
    chapter = args[3] ?? chapter;
  }
  if (href && href !== '#' && !/^javascript:\s*(?:void\(0\);?|;)$/i.test(href) && !(args && handler === href)) {
    if (!URL.canParse(href, doc.URL)) return;
    const next = getCoursePage(new URL(href, doc.URL));
    if (!next?.chapter || next.course !== page.course) return;
    chapter = next.chapter;
  }
  return { control: anchor ?? control, chapter };
}
