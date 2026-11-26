(() => {
  const course = window.top === window && location.pathname.endsWith('/mycourse/studentstudy');
  const remote = location.origin === 'https://pan-yz.chaoxing.com' && location.pathname.startsWith('/screen/v2/');
  const kind = course ? '课程' : remote ? '跨域阅读器' : location.pathname.includes('knowledge/cards') ? '教材页签' : '嵌入内容';
  let start = 0, cleanup = () => {};
  function record(stamp) {
    if (stamp === start) return;
    cleanup();
    start = stamp;
    if (!stamp) return;
    const ac = new AbortController();
    const opts = {signal:ac.signal, capture:true, passive:true};
    const observers = [];
    function note(text) {
      chrome.runtime.sendMessage({type:'line', start:stamp, when:Date.now(),
        text:kind+' '+document.visibilityState+' '+text}).catch(() => {});
    }
    note('开始观察');
    for (const name of ['visibilitychange','freeze','resume']) document.addEventListener(name, () => note(name), opts);
    window.addEventListener('pagehide', () => note('pagehide'), opts);
    window.addEventListener('message', event => {
      const m = event.data;
      if (!m || !Number.isSafeInteger(m.sequence) || typeof m.id !== 'string') return;
      const key = /^[-\da-f]{36}$/i.test(m.id) ? m.id.slice(-8) : '?';
      if (remote && event.source === window.top && /^https:\/\/(?:[\w-]+\.)*chaoxing\.com$/.test(event.origin) && m.kind === 'course-queue:reader-step')
        note('收到滚动指令 '+key+'/'+m.sequence);
      if (course && event.origin === 'https://pan-yz.chaoxing.com' && m.kind === 'course-queue:reader-progress' && ['loading','moving','bottom'].includes(m.result))
        note('收到阅读器回报 '+key+'/'+m.sequence+' '+m.result);
    }, opts);
    const lastScroll = new WeakMap();
    document.addEventListener('scroll', e => {
      const el = e.target === document ? document.scrollingElement : e.target;
      if (!(el instanceof Element)) return;
      const y = Math.round(el.scrollTop), max = Math.max(0, el.scrollHeight-el.clientHeight);
      if (!max) return;
      const now = Date.now(), old = lastScroll.get(el);
      if (old && now-old.t < 350 && y < max-2) return;
      if (old?.y === y && old.max === max) return;
      lastScroll.set(el,{y,max,t:now});
      note('滚动 '+el.tagName+' '+y+'/'+max+' px');
    }, opts);
    for (const name of ['playing','pause','ended']) document.addEventListener(name,e => {
      if (e.target instanceof HTMLVideoElement) note('视频 '+name+' '+Math.round(e.target.currentTime)+' 秒');
    },opts);
    let previous = '', panel, previousPanel = '';
    function inspect() {
      const row = course && document.querySelector('#coursetree .posCatalog_active');
      const marks = [...document.querySelectorAll('.ans-job-icon')];
      const counters = row ? [...row.querySelectorAll('.jobUnfinishCount,.jobCount,.catalog_points_yi')].filter(x=>x.getClientRects().length).map(x=>x.textContent.trim()).filter(x=>/^\d{1,4}$/.test(x)) : [];
      const check = row && [...row.querySelectorAll('.icon_Completed')].some(x=>x.getClientRects().length);
      const summary = [row ? '目录绿勾='+Boolean(check)+' 数字='+(counters.join(',')||'无') : '',
        marks.length ? '页内完成标记='+marks.filter(x=>x.closest('.ans-job-finished') || [x.title,x.textContent.trim(),x.getAttribute('aria-label')].includes('任务点已完成')).length+'/'+marks.length : ''].filter(Boolean).join(' ');
      if (summary && summary !== previous) note(summary);
      previous = summary;
      if (!course || panel?.host.isConnected) return;
      panel = [...(document.body?.children || [])].map(x=>x.shadowRoot).find(r=>r?.querySelector('details[aria-label="课序"]'));
      if (!panel) return;
      const panelChanged = () => {
        const s = (panel.querySelector('.start')?.textContent || '')+' '+(panel.querySelector('.status')?.textContent || '');
        if (s !== previousPanel) note('课序面板 '+s.slice(0,140));
        previousPanel = s;
      };
      observe(panel,panelChanged);
      panelChanged();
    }
    function observe(root, fn) {
      const mo = new MutationObserver(fn);
      mo.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','aria-label','hidden','style']});
      observers.push(mo);
    }
    if (course || kind === '教材页签') { observe(document,inspect); inspect(); }
    cleanup = () => { ac.abort(); observers.forEach(o=>o.disconnect()); };
  }
  let revision = 0;
  chrome.runtime.onMessage.addListener((m,_,reply) => {
    if (m.type === 'course?') { reply(course); return; }
    if (m.type === 'record') { revision++; record(m.start); reply(true); }
  });
  chrome.runtime.sendMessage({type:'init'}).then(r => {
    if (!revision && r?.value?.recording) record(r.value.start);
  }).catch(() => {});
})();