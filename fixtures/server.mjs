import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const port = 4173;
const study = '/mooc-ans/mycourse/studentstudy';
const cards = '/mooc-ans/knowledge/cards';
const player = '/ananas/modules/video/index.html';
const reader = '/ananas/modules/pdf/index.html';
const pan = '/screen/v2/fixture';
const panOrigin = 'https://pan-yz.chaoxing.com';
const clip = await readFile(new URL('./sample.webm', import.meta.url));
const audibleClip = await readFile(new URL('./sample-audible.webm', import.meta.url));
const names = ['01 认识课程', '02 阅读目录', '03 下一步'];
const loopNames = ['2.1 视频和资料', '2.4 章节图谱', '2.5 章节讨论', '2.6 章节测验',
  '3.1 课件阅读', '3.2 知识练习', '3.3 章节测验讲解视频', '3.4 先教材再视频'];
const modes = ['reload', 'spa', 'locked', 'quiz', 'unconfirmed', 'other-task', 'multi', 'multi-cards', 'multi-unconfirmed',
  'chain', 'chain-spa', 'reader-local', 'reader-unconfirmed', 'numbered', 'numbered-unmarked', 'numbered-stack', 'numbered-stack-pending',
  'loop', 'loop-spa', 'loop-locked', 'audible', 'numbered-checkmark', 'numbered-checkmark-pending'];

function page(title, content) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title>${content}</html>`;
}

function courseUrl(chapter, mode) {
  return `${study}?courseId=10&amp;clazzid=20&amp;chapterId=${chapter}&amp;fixture=${mode}`;
}

function cardsUrl(chapter, mode, card = 0) {
  return `${cards}?knowledgeid=${chapter}&amp;fixture=${mode}&amp;num=${card}`;
}

function taskTabs(chapter, mode) {
  if (mode.startsWith('loop')) {
    const labels = chapter === 1 ? ['1 慕课视频', '2 教材+PPT']
      : chapter === 8 ? ['1 教材+PPT', '2 慕课视频'] : [];
    return labels.length ? '<div class="tabtags">' + labels.map((label, index) =>
      `<span class="${index === 0 ? 'currents' : ''}">${label}</span>`).join('') + '</div>' : '';
  }
  if (mode.startsWith('numbered')) {
    const unmarked = mode === 'numbered-unmarked';
    return `<div class="${unmarked ? 'study-switch' : 'tabtags'}"><span class="${unmarked ? '' : 'currents'}"><i>1</i> 慕课视频</span><span><i>2</i> 教材+PPT</span></div>`;
  }
  return ['multi-cards', 'chain', 'chain-spa', 'reader-local', 'reader-unconfirmed'].includes(mode)
    ? '<div class="ncells"><button class="currents">慕课视频</button><button>教材+PPT</button></div>' : '';
}

function courseDocument(chapter, mode) {
  const loop = mode.startsWith('loop');
  const numbered = mode.startsWith('numbered') || loop;
  const spa = mode === 'spa' || mode === 'chain-spa' || mode === 'numbered-unmarked' || mode === 'loop-spa';
  const frameId = numbered ? 'lesson-frame' : 'iframe';
  const chapterNames = loop ? loopNames : names;
  const rows = chapterNames.map((name, index) => {
    const id = index + 1;
    const active = chapter === id ? ' posCatalog_active' : '';
    const locked = (mode === 'locked' && id === 2) || (mode === 'loop-locked' && id === 5);
    let link = `<a class="posCatalog_name" href="${courseUrl(id, mode)}">${name}</a>`;
    if (spa) link = `<a class="posCatalog_name" href="javascript:;" onclick="getTeacherAjax(10, 20, ${id})">${name}</a>`;
    if (locked) link = `<button type="button" class="posCatalog_name" disabled>${name}（未开放）</button>`;
    const heading = loop && (id === 1 || id === 5)
      ? `<li class="posCatalog_select firstLayer">${id === 1 ? '2 第一章' : '3 第二章'}</li>` : '';
    const counter = loop && (id === 4 || id === 6) ? '<span class="jobCount">1</span>' : '';
    return `${heading}<li class="posCatalog_select${active}" data-chapterid="${id}">${link}${counter}</li>`;
  }).join('');
  const script = `
    const iframe = document.querySelector('#${frameId}');
    const currentChapter = document.querySelector('#curChapterId');
    const tabArea = document.querySelector('#course-tabs');
    const tabMarkup = ${JSON.stringify(chapterNames.map((_, index) => taskTabs(index + 1, mode)))};
    const getTabs = () => [...(tabArea.firstElementChild?.children ?? [])];
    function showCard(num) {
      if (${mode !== 'numbered-unmarked'}) {
        for (const [index, tab] of getTabs().entries()) tab.classList.toggle('currents', index === num);
      }
      iframe.src = '${cards}?knowledgeid=' + currentChapter.value + '&fixture=${mode}&num=' + num;
    }
    tabArea.addEventListener('click', (event) => {
      const index = getTabs().findIndex(tab => tab.contains(event.target));
      if (index >= 0) showCard(index);
    });
    function getTeacherAjax(course, clazz, chapter) {
      document.querySelector('.posCatalog_active').classList.remove('posCatalog_active');
      document.querySelector('[data-chapterid="' + chapter + '"]').classList.add('posCatalog_active');
      currentChapter.value = chapter;
      tabArea.innerHTML = tabMarkup[chapter - 1];
      showCard(0);
    }
  `;
  return page('课序示例课程', `
    <main style="font:16px system-ui;max-width:740px;margin:40px auto">
      <h1>课序示例课程</h1>
      <ul id="coursetree">${rows}</ul>
      <input id="curChapterId" type="hidden" value="${chapter}">
      <div id="course-tabs">${taskTabs(chapter, mode)}</div>
      <iframe id="${frameId}" width="620" height="410" title="课程内容" src="${cardsUrl(chapter, mode)}"></iframe>
    </main><script>${script}</script>
  `);
}

function stackedReaders(mode) {
  function frame(index, mark) {
    const marker = mark ? `<p class="ans-job-icon">${mark}</p>` : '';
    return `${marker}<iframe id="document-${index}" class="ans-zt-attach-online" loading="lazy"
      title="示例资料 ${index}" width="580" height="305" src="${reader}?fixture=${mode}&amp;document=${index}"></iframe>`;
  }
  const waitOnSecond = mode === 'numbered-stack-pending';
  return page('教材+PPT', `
    <div class="ans-attach-ct">
      ${frame(1, '任务点已完成')}
      ${frame(2, waitOnSecond ? '任务点' : '')}
      <div style="height:420px" aria-hidden="true"></div>
      <div id="more-materials">下方资料加载区</div>
    </div>
    <script>
      const more = document.querySelector('#more-materials');
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        setTimeout(() => more.insertAdjacentHTML('afterend', ${JSON.stringify(frame(3, '任务点'))}), 450);
      });
      observer.observe(more);
      addEventListener('message', event => {
        if (event.origin !== location.origin || event.data !== 'fixture-reader-bottom') return;
        const last = document.querySelector('#document-3');
        if (!last || event.source !== last.contentWindow) return;
        setTimeout(() => { last.previousElementSibling.textContent = '任务点已完成'; }, 2200);
      });
    </script>
  `);
}

function catalogConfirmedReaders(mode) {
  const readers = Array.from({ length: 4 }, (_, index) => `
    <div class="ans-attach-ct">
      <p class="ans-job-icon">任务点</p>
      <iframe class="ans-zt-attach-online" title="示例资料 ${index + 1}" width="580" height="305"
        src="${reader}?fixture=${mode}&amp;document=${index + 1}"></iframe>
    </div>`).join('');
  return page('教材+PPT', `${readers}<script>
    const frames = [...document.querySelectorAll('iframe')];
    const visited = new Set();
    addEventListener('message', event => {
      if (event.origin !== location.origin || event.data !== 'fixture-reader-bottom') return;
      const index = frames.findIndex(frame => frame.contentWindow === event.source);
      if (index < 0) return;
      visited.add(index);
      if (visited.size !== 4) return;
      frames[3].previousElementSibling.textContent = '任务点已完成';
      const row = top.document.querySelector('#coursetree .posCatalog_active');
      if (row?.querySelector('.icon_Completed')) return;
      row?.insertAdjacentHTML('beforeend', '<span class="prevTips icon_Completed" title="已完成">✓</span>'
        + (${mode === 'numbered-checkmark-pending'} ? '<span class="jobUnfinishCount">1</span>' : ''));
    });
  </script>`);
}

function cardDocument(chapter, mode, card) {
  const loop = mode.startsWith('loop');
  const readingCard = loop ? (chapter === 1 && card === 1) || (chapter === 5 || chapter === 8) && card === 0 : card === 1;
  if (readingCard) {
    if (mode.startsWith('numbered-checkmark') && chapter === 1) return catalogConfirmedReaders(mode);
    if (mode.startsWith('numbered-stack') && chapter === 1) return stackedReaders(mode);
    if (loop && chapter === 1) return stackedReaders(mode);
    return page('教材+PPT', `
      <div class="ans-attach-ct">
        <p class="ans-job-icon" aria-label="任务点未完成">任务点未完成</p>
        <iframe class="ans-zt-attach-online" title="示例教材" width="580" height="305" src="${reader}?fixture=${mode}"></iframe>
      </div>
      <script>
        const frame = document.querySelector('iframe');
        window.addEventListener('message', event => {
          if (event.source !== frame.contentWindow || event.origin !== location.origin
            || event.data !== 'fixture-reader-bottom' || ${mode === 'reader-unconfirmed'}) return;
          setTimeout(() => {
            const task = frame.closest('.ans-attach-ct');
            const icon = task.querySelector('.ans-job-icon');
            icon.textContent = '任务点已完成';
            icon.setAttribute('aria-label', '任务点已完成');
            task.classList.add('ans-job-finished');
          }, 2600);
        });
      </script>
    `);
  }
  if (mode.startsWith('numbered') && chapter === 1) {
    return page(names[0], '<div class="ans-attach-ct"><span class="ans-job-icon">任务点已完成</span></div>');
  }
  if ((mode === 'quiz' && chapter === 2) || (loop && (chapter === 4 || chapter === 6))) {
    return page('章节测验', '<form action="/work/example"><h2>示例章节测验</h2></form>');
  }
  if (loop && (chapter === 2 || chapter === 3)) {
    return page('附加小节', '<h2>' + loopNames[chapter - 1] + '</h2>');
  }
  const finish = mode !== 'unconfirmed' && mode !== 'multi-unconfirmed';
  const multi = ((mode.startsWith('multi') || mode.startsWith('chain') || loop) && chapter === 1)
    || (mode === 'audible' && chapter === 2);
  const playerUrl = mode === 'audible' && chapter > 1 ? player + '?audio=1' : player;
  const extra = mode === 'other-task' ? '<div class="ans-attach-ct"><span class="ans-job-icon">课件任务未完成</span></div>' : '';
  const video = `
    <div class="ans-attach-ct">
      <p class="ans-job-icon" aria-label="任务点未完成">任务点未完成</p>
      <iframe class="ans-insertvideo-online" title="示例播放器" width="522" height="310" src="${playerUrl}"></iframe>
    </div>
  `;
  return page('示例小节', `
    <h2>${(loop ? loopNames : names)[chapter - 1]}</h2>${video}${multi ? video : ''}${extra}
    <script>
      if (${finish}) {
        for (const frame of document.querySelectorAll('.ans-insertvideo-online')) {
          frame.addEventListener('load', () => {
            const media = frame.contentDocument.querySelector('video');
            media.addEventListener('ended', () => {
              setTimeout(() => {
                const task = frame.closest('.ans-attach-ct');
                const icon = task.querySelector('.ans-job-icon');
                icon.textContent = '任务点已完成';
                icon.setAttribute('aria-label', '任务点已完成');
                task.classList.add('ans-job-finished');
              }, 1100);
            });
          });
        }
      }
    </script>
  `);
}

function readerDocument(remote = false, innerViewport = false) {
  const paragraphs = Array.from({ length: 24 }, (_, index) =>
    `<p style="margin:0;padding:18px;border-bottom:1px solid #e6eae9">第 ${index + 1} 段　这是供本地测试的教材内容。</p>`).join('');
  return page('示例教材阅读器', `<main${innerViewport ? ' class="slide-scroll" style="height:200px;overflow-y:auto"' : ''}>${paragraphs}</main>
    <script>
      const inner = document.querySelector('.slide-scroll');
      const viewport = inner ?? document.scrollingElement;
      (inner ?? window).addEventListener('scroll', () => {
        if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2) {
          parent.postMessage('fixture-reader-bottom', ${remote ? 'new URL(document.referrer).origin' : 'location.origin'});
        }
      });
    </script>`);
}

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost:' + port);
  const fixture = url.searchParams.get('fixture');
  const mode = modes.includes(fixture) ? fixture : 'reload';
  const id = Number(url.searchParams.get('chapterId') ?? url.searchParams.get('knowledgeid'));
  const chapter = id >= 1 && id <= (mode.startsWith('loop') ? loopNames : names).length && Number.isInteger(id) ? id : 1;
  let html;
  switch (url.pathname) {
    case '/':
      html = page('课序测试场景', '<ul>' + modes.map((name) => `<li><a href="${courseUrl(1, name)}">${name}</a></li>`).join('') + '</ul>');
      break;
    case study:
      html = courseDocument(chapter, mode);
      break;
    case cards:
      html = cardDocument(chapter, mode, Number(url.searchParams.get('num')));
      break;
    case player:
      html = page('播放器', `<video controls width="500" height="282" src="${url.searchParams.has('audio') ? '/sample-audible.webm' : '/sample.webm'}"></video>`);
      break;
    case reader:
      html = mode === 'reader-local' ? readerDocument() : page('教材外框', `
        <iframe id="panView" title="跨域阅读器" width="535" height="250" src="${panOrigin + pan}?fixture=${mode}"></iframe>
        <script>
          const viewer = document.querySelector('iframe');
          addEventListener('message', event => {
            if (event.origin === '${panOrigin}' && event.source === viewer.contentWindow && event.data === 'fixture-reader-bottom') {
              parent.postMessage('fixture-reader-bottom', location.origin);
            }
          });
        </script>`);
      break;
    case pan:
      html = readerDocument(true, mode.startsWith('numbered') || mode.startsWith('loop'));
      break;
    case '/sample.webm':
      response.writeHead(200, { 'Content-Type': 'video/webm' });
      response.end(clip);
      return;
    case '/sample-audible.webm':
      response.writeHead(200, { 'Content-Type': 'video/webm' });
      response.end(audibleClip);
      return;
    case '/favicon.ico':
      response.writeHead(204);
      response.end();
      return;
    default:
      response.writeHead(404);
      response.end();
      return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}).listen(port, 'localhost', () => console.log('课序示例 http://localhost:' + port));
