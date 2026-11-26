const db = chrome.storage.session;
let queue = Promise.resolve();
function serial(fn) {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}
async function handle(request, sender) {
  const { report } = await db.get('report');
  const tab = sender.tab?.id;
  if (tab !== undefined) {
    const recording = report?.tab === tab && report.active;
    if (request.type === 'init') return { recording, start: report?.start };
    if (request.type !== 'line' || !recording || request.start !== report.start) return;
    report.lines.push([request.when, sender.frameId, request.text.slice(0,240)]);
    if (report.lines.length > 2400) { report.lines.shift(); report.dropped++; }
    await db.set({report});
    return;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (request.type === 'report') return report;
  if (request.type === 'start') {
    const tabId = request.tab;
    const isCourse = await chrome.tabs.sendMessage(tabId, {type:'course?'}, {frameId:0}).catch(() => false);
    if (!isCourse) throw new Error('请刷新学习通章节页，并在该页打开课序诊断。');
    const start = Date.now();
    if (report?.active) await chrome.tabs.sendMessage(report.tab, {type:'record', start:0}).catch(() => {});
    await db.set({report:{tab:tabId, start, active:true, dropped:0, lines:[]}});
    await chrome.tabs.sendMessage(tabId, {type:'record', start});
    return;
  }
  if (request.type === 'stop' && report) {
    report.active = false;
    await db.set({report});
    await chrome.tabs.sendMessage(report.tab, {type:'record', start:0}).catch(() => {});
  }
}
chrome.runtime.onMessage.addListener((r,s,reply) => {
  serial(() => handle(r,s)).then(value => reply({value}), error => reply({error:error.message}));
  return true;
});