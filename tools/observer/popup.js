const $ = id=>document.getElementById(id);
const area = document.querySelector('textarea');
async function request(payload) {
  const result = await chrome.runtime.sendMessage(payload);
  if (result?.error) throw new Error(result.error);
  return result?.value;
}
async function show() {
  const r = await request({type:'report'});
  $('info').textContent = r?.active ? '记录中。可以切走，回来后等几秒再结束记录。' : r ? '记录已结束，可以复制。' : '在学习通课程页开始记录。每次新记录会替换上一次。';
  $('start').disabled = !!r?.active;
  $('stop').disabled = !r?.active;
  $('copy').disabled = !r?.lines.length;
  area.value = !r ? '' : ['课序诊断；时间为开始后的秒数；frame 0 为课程主页。',r.dropped ? '较早记录已截断 '+r.dropped+' 条。' : '',
    ...r.lines.sort((a,b)=>a[0]-b[0]).map(([t,f,s])=>((t-r.start)/1000).toFixed(2)+'s  frame '+f+'  '+s)].filter(Boolean).join('\n');
}
$('start').onclick = async () => {try {const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); await request({type:'start',tab:tab.id}); await show();} catch(e){$('info').textContent=e.message;}};
$('stop').onclick = async () => {await request({type:'stop'}); await show();};
$('copy').onclick = async () => {try {await navigator.clipboard.writeText(area.value); $('info').textContent='已复制。';} catch {area.focus();area.select();$('info').textContent='记录已选中，按 Ctrl+C 复制。';}};
show();