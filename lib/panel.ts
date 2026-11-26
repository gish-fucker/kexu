import { browser } from 'wxt/browser';

const panelStyle = `
  :host { all: initial; position: fixed; inset: auto 20px 20px auto; z-index: 2147483000;
    width: min(320px, calc(100vw - 40px)); color: #142323;
    font: 14px/1.45 system-ui, 'Microsoft YaHei UI', sans-serif; }
  details { background: #f9fbfa; border: 1px solid #c6d6d3; border-radius: 16px;
    box-shadow: 0 9px 32px #14232325; overflow: hidden; }
  summary { list-style: none; cursor: pointer; display: flex; align-items: center;
    gap: 9px; padding: 10px 14px; font-weight: 700; font-size: 14px; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: '＋'; margin-left: auto; color: #475d59; }
  details[open] summary::after { content: '−'; }
  .mark { display: grid; place-items: center; width: 24px; height: 24px;
    border-radius: 7px; background: #086858; color: #fff; font-size: 12px; }
  .body { border-top: 1px solid #dce6e4; padding: 11px 14px 14px; }
  .chapter { margin: 0 0 4px; font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
  .status { color: #475d59; margin: 0 0 10px; }
  button { color: #fff; background: #086858; border: 0; border-radius: 8px;
    padding: 7px 15px; font: inherit; font-weight: 650; cursor: pointer; }
  button:hover { background: #075246; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .sound { color: #21443d; background: #e3eeeb; }
  .sound:hover { background: #d4e7e2; }
  .sound:disabled { opacity: .55; cursor: default; }
  :focus-visible { outline: 2px solid #11796b; outline-offset: 2px; }
`;

export function mountPanel(doc: Document, onClick: () => void, onMute: () => void, onVideoSound: () => void) {
  const host = doc.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${panelStyle}</style>
    <details open aria-label="课序">
      <summary><span class="mark" aria-hidden="true">▶</span>课序 <small>v${browser.runtime.getManifest().version}</small></summary>
      <div class="body">
        <p class="chapter"></p>
        <p class="status" role="status"></p>
        <div class="actions">
          <button class="start" type="button">开始</button>
          <button class="sound tab-sound" type="button" disabled>静音标签页</button>
          <button class="sound video-sound" type="button" hidden>开启视频声音</button>
        </div>
      </div>
    </details>
  `;
  const chapter = root.querySelector<HTMLParagraphElement>('.chapter')!;
  const status = root.querySelector<HTMLParagraphElement>('.status')!;
  const button = root.querySelector<HTMLButtonElement>('.start')!;
  const mute = root.querySelector<HTMLButtonElement>('.tab-sound')!;
  const videoSound = root.querySelector<HTMLButtonElement>('.video-sound')!;
  button.addEventListener('click', (event) => {
    if (event.isTrusted) onClick();
  });
  mute.addEventListener('click', (event) => {
    if (event.isTrusted) onMute();
  });
  videoSound.addEventListener('click', (event) => {
    if (event.isTrusted) onVideoSound();
  });
  doc.body.append(host);

  return {
    updateVideoSound(visible: boolean) {
      videoSound.hidden = !visible;
    },
    updateMute(muted: boolean | null, pending = false) {
      mute.disabled = muted === null || pending;
      mute.textContent = muted ? '取消静音' : '静音标签页';
    },
    update(title: string, message: string, active: boolean) {
      const action = active ? '暂停' : '开始';
      if (chapter.textContent !== title) chapter.textContent = title;
      if (status.textContent !== message) status.textContent = message;
      if (button.textContent !== action) button.textContent = action;
    },
    remove() {
      host.remove();
    },
  };
}
