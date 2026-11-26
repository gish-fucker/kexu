// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { canOpenTaskCard, chapterCompletion, completed, findNextChapter, getCoursePage, inspectLesson, readTaskCards, tasksReady } from './course-page';

const study = '/mooc-ans/mycourse/studentstudy?courseId=1&clazzid=1&chapterId=10';

beforeEach(() => {
  history.replaceState(null, '', study);
  document.body.replaceChildren();
});

describe('learning status', () => {
  it('reads the page confirmation without confusing it with unfinished text', () => {
    document.body.innerHTML = '<div class="ans-attach-ct"><video></video><i class="ans-job-icon" aria-label="任务点未完成"></i></div>';
    const lesson = inspectLesson(document);
    if (lesson.kind !== 'tasks') throw new Error('Expected a recognized video');
    const task = lesson.videos[0]?.task ?? null;
    expect(completed(task)).toBe(false);
    task?.querySelector('i')?.setAttribute('aria-label', '任务点已完成');
    expect(completed(task)).toBe(true);
  });

  it('reports a different unfinished task alongside the video', () => {
    document.body.innerHTML = `
      <div class="ans-attach-ct ans-job-finished"><video></video></div>
      <div class="ans-attach-ct"><span class="ans-job-icon">未完成任务</span></div>`;
    expect(inspectLesson(document)).toMatchObject({ kind: 'tasks', pendingOtherTask: true });
  });

  it('recognizes both video tasks on the same page in document order', () => {
    document.body.innerHTML = `
      <div class="ans-attach-ct" id="first"><i class="ans-job-icon"></i><video></video></div>
      <div class="ans-attach-ct" id="second"><i class="ans-job-icon"></i><video></video></div>`;
    expect(inspectLesson(document)).toMatchObject({
      kind: 'tasks',
      videos: [{ task: document.querySelector('#first') }, { task: document.querySelector('#second') }],
      pendingOtherTask: false,
    });
  });

  it('recognizes a standalone assessment as a skippable section', () => {
    document.body.innerHTML = '<form action="/work/test"></form>';
    expect(inspectLesson(document).kind).toBe('skip');
  });

  it('keeps the manual stop for a question in the video player', () => {
    document.body.innerHTML = '<video></video><div class="vjs-quiz">请回答</div>';
    expect(inspectLesson(document).kind).toBe('manual');
  });

  it('does not skip a chapter that shows a video alongside a quiz', () => {
    document.body.innerHTML = '<video></video><form action="/work/test"></form>';
    expect(inspectLesson(document).kind).toBe('manual');
  });

  it('keeps a loading iframe in the video order', () => {
    document.body.innerHTML = `
      <div class="ans-attach-ct"><iframe class="ans-insertvideo-online" src="https://example.com"></iframe></div>
      <div class="ans-attach-ct"><video></video></div>`;
    expect(inspectLesson(document)).toMatchObject({ kind: 'tasks', videos: [{ video: null }, { video: document.querySelector('video') }] });
  });

  it('recognizes that the current video card has sibling task cards', () => {
    document.body.innerHTML = '<div class="ncells"><a class="currents">慕课视频</a><a>教材+PPT</a></div>';
    const tabs = readTaskCards(document);
    expect(tabs?.index).toBe(0);
    expect(tabs && canOpenTaskCard(tabs.cards[1]!)).toBe(true);
  });

  it('recognizes numbered span tabs with a delegated page click handler', () => {
    document.body.innerHTML = '<div class="tabtags"><span class="currents"><i>1</i> 慕课视频</span><span><i>2</i> 教材+PPT</span></div>';
    const tabs = readTaskCards(document);
    expect(tabs?.cards.map((card) => card.textContent)).toEqual(['1 慕课视频', '2 教材+PPT']);
    expect(tabs?.index).toBe(0);
  });

  it('reads the numbered pair in another tab layout', () => {
    document.body.innerHTML = '<div class="study-switch"><span data-state="active">1 慕课视频</span><span>2 教材＋PPT</span></div>';
    const tabs = readTaskCards(document);
    expect(tabs?.cards).toHaveLength(2);
    expect(tabs?.index).toBe(0);
  });

  it('accepts the page completion label when the completed player is no longer mounted', () => {
    document.body.innerHTML = '<div class="ans-attach-ct"><span class="ans-job-icon">任务点已完成</span></div>';
    expect(tasksReady(inspectLesson(document), new Map(), new Map())).toBe(true);
  });

  it('keeps separate readers in order even if they share an attachment wrapper', () => {
    document.body.innerHTML = `
      <div class="ans-attach-ct">
        <span class="ans-job-icon" id="done">任务点已完成</span><iframe src="/ananas/modules/pdf/first.html"></iframe>
        <iframe src="/ananas/modules/ppt/extra.html"></iframe>
        <span class="ans-job-icon" id="pending">任务点</span><iframe src="/ananas/modules/pdf/last.html"></iframe>
      </div>`;
    const lesson = inspectLesson(document);
    expect(lesson).toMatchObject({ kind: 'tasks', pendingOtherTask: false, readings: [
      { task: document.querySelector('#done') }, { task: null }, { task: document.querySelector('#pending') },
    ] });
    expect(tasksReady(lesson, new Map(), new Map())).toBe(false);
  });

  it('requires each reader to settle on its current source and every video to finish', () => {
    document.body.innerHTML = `
      <div class="ans-attach-ct"><iframe src="/ananas/modules/ppt/extra.html"></iframe></div>
      <div class="ans-attach-ct"><i class="ans-job-icon">任务点</i><iframe src="/ananas/modules/pdf/last.html"></iframe></div>
      <div class="ans-attach-ct"><video src="/first.mp4"></video></div>`;
    const [first, second] = document.querySelectorAll('iframe');
    const video = document.querySelector('video')!;
    const bottoms = new Map([[first!, first!.src]]);
    const ended = new Map([[video, video.src]]);
    const ready = () => tasksReady(inspectLesson(document), bottoms, ended);
    expect(ready()).toBe(false);
    bottoms.set(second!, second!.src);
    expect(ready()).toBe(true);
    video.src = '/second.mp4';
    expect(ready()).toBe(false);
    video.parentElement!.classList.add('ans-job-finished');
    expect(ready()).toBe(true);
    document.body.insertAdjacentHTML('beforeend', '<span class="ans-job-icon">其他任务点</span>');
    expect(ready()).toBe(false);
  });
});

describe('chapter navigation', () => {
  function catalog(next: string) {
    document.body.innerHTML = `
      <ul id="coursetree">
        <li class="posCatalog_select posCatalog_active"><span class="posCatalog_name">当前</span></li>
        <li class="posCatalog_select">${next}</li>
        <li class="posCatalog_select"><button>后续可播放小节</button></li>
      </ul>`;
    return getCoursePage(new URL(document.URL))!;
  }

  it('requires a visible completion marker belonging to the current row', () => {
    catalog('<button>下一节</button><span class="icon_Completed"></span>');
    const current = document.querySelector('.posCatalog_active')!;
    current.insertAdjacentHTML('beforeend', `
      <span class="jobCount">0</span>
      <span hidden><span class="icon_Completed"></span></span>
      <div class="posCatalog_select"><span class="icon_Completed"></span></div>`);
    expect(chapterCompletion(document)).toBe('unknown');
    current.insertAdjacentHTML('beforeend', '<span class="icon_Completed"></span>');
    expect(chapterCompletion(document)).toBe('complete');
  });

  it.each(['catalog_points_yi', 'jobCount', 'jobUnfinishCount'])(
    'gives a visible positive %s priority over the completion marker',
    (counterClass) => {
      catalog('<button>下一节</button>');
      const current = document.querySelector('.posCatalog_active')!;
      current.insertAdjacentHTML('beforeend', `
        <span class="icon_Completed"></span>
        <span class="jobCount" hidden>4</span>
        <span class="catalog_points_yi">0</span>
        <span class="${counterClass}">2</span>`);
      expect(chapterCompletion(document)).toBe('pending');
      current.lastElementChild!.setAttribute('hidden', '');
      expect(chapterCompletion(document)).toBe('complete');
    },
  );

  it('uses the adjacent link in the same course and reads its chapter ID', () => {
    const current = catalog('<a href="' + study.replace('chapterId=10', 'chapterId=11') + '">下一节</a>');
    expect(findNextChapter(document, current)).toMatchObject({ chapter: '11' });
  });

  it('reads a decorative visible check or labeled status only on the active chapter', () => {
    catalog('<button>下一节</button><img alt="已完成">');
    const row = document.querySelector('.posCatalog_active')!;
    row.insertAdjacentHTML('beforeend', '<i title="任务点未完成"></i><i class="icon_Completed" style="display:none"></i>');
    expect(chapterCompletion(document)).toBe('unknown');
    row.insertAdjacentHTML('beforeend', '<img aria-hidden="true" alt="任务点已完成">');
    expect(chapterCompletion(document)).toBe('complete');
    row.insertAdjacentHTML('beforeend', '<span class="jobUnfinishCount">1</span>');
    expect(chapterCompletion(document)).toBe('pending');
  });

  it('recognizes the chapter ID on the native course directory control', () => {
    const current = catalog('<a href="javascript:;" class="posCatalog_name" onclick="getTeacherAjax(1, 1, 11)">下一节</a>');
    expect(findNextChapter(document, current)).toMatchObject({ chapter: '11' });
  });

  it('stops at a locked chapter without skipping to later chapters', () => {
    const current = catalog('<button disabled>下一节</button>');
    expect(findNextChapter(document, current)).toBe('locked');
  });

  it('can open an available chapter whose lock indicator is hidden', () => {
    const current = catalog('<a href="' + study.replace('chapterId=10', 'chapterId=11') + '">下一节</a><span class="lock" hidden></span>');
    expect(findNextChapter(document, current)).toMatchObject({ chapter: '11' });
  });

  it('skips numbered graph, discussion and quiz rows to reach the next learning section', () => {
    const current = catalog('<button>2.4 章节图谱</button>');
    document.querySelector('#coursetree li:last-child')?.insertAdjacentHTML('beforebegin', `
      <li class="posCatalog_select"><button>2.5 章节讨论</button></li>
      <li class="posCatalog_select"><button>2.6 章节测验</button></li>
    `);
    document.querySelector('#coursetree li:last-child')?.setAttribute('data-chapterid', '13');
    expect(findNextChapter(document, current)).toMatchObject({ chapter: '13', skipped: 3 });
  });

  it('does not pass an explicitly locked row while looking for the next learning section', () => {
    const current = catalog('<button disabled>2.6 章节测验</button>');
    expect(findNextChapter(document, current)).toBe('locked');
  });

  it('allows a video section whose title happens to mention a quiz', () => {
    const current = catalog('<a href="' + study.replace('chapterId=10', 'chapterId=11') + '">章节测验讲解视频</a>');
    expect(findNextChapter(document, current)).toMatchObject({ chapter: '11', skipped: 0 });
  });

  it('rejects links into another course or off site', () => {
    const current = catalog('<a href="' + study.replace('courseId=1', 'courseId=2') + '">下一节</a>');
    expect(findNextChapter(document, current)).toBe('manual');
    document.querySelector('a')!.href = 'https://example.com' + study;
    expect(findNextChapter(document, current)).toBe('manual');
  });

  it('reports the end of the catalog', () => {
    const current = catalog('<button>下一节</button>');
    document.querySelectorAll('li').forEach((row, index) => {
      if (index > 0) row.remove();
    });
    expect(findNextChapter(document, current)).toBe('last');
  });
});
