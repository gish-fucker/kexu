export const readerOrigin = 'https://pan-yz.chaoxing.com';
export const readerPath = '/screen/v2/';
export const readerStep = 'course-queue:reader-step';
export const readerProgress = 'course-queue:reader-progress';

export type ScrollResult = 'loading' | 'moving' | 'bottom';

const nestedReader = 'iframe#panView, iframe#img, iframe[src^="' + readerOrigin + readerPath + '"]';
export const documentFrames = 'iframe[src*="/ananas/modules/pdf/"], iframe[src*="/ananas/modules/ppt/"], iframe.ans-zt-attach-online, ' + nestedReader;

export function scrollReader(doc: Document): ScrollResult {
  const containers = [...doc.querySelectorAll<HTMLElement>('#viewerContainer, #panView, #docContainer, #img, .imglook, .documentImg')];
  const scrollable = (node: Element | null): node is Element =>
    !!node && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2;
  const viewport = (node: Element) =>
    scrollable(node) && /^(auto|scroll|overlay)$/.test(doc.defaultView?.getComputedStyle(node).overflowY ?? '');
  const scroller = containers.find(viewport)
    ?? [...doc.querySelectorAll('main, article, section, div')].filter(viewport)
      .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0]
    ?? (scrollable(doc.scrollingElement) ? doc.scrollingElement : undefined);
  if (!scroller) return 'loading';
  const max = scroller.scrollHeight - scroller.clientHeight;
  const before = scroller.scrollTop;
  if (before >= max - 2) return 'bottom';
  scroller.scrollBy({ top: Math.max(1, Math.floor(scroller.clientHeight * 0.9)), behavior: 'instant' });
  return scroller.scrollTop > before ? 'moving' : 'loading';
}

type ReaderTarget = { doc: Document } | { frame: Window };

export function locateReader(frame: HTMLIFrameElement): ReaderTarget | undefined {
  if (frame.loading === 'lazy') frame.loading = 'eager';
  const doc = frame.contentDocument;
  if (doc && doc.URL !== 'about:blank') {
    const nested = doc.querySelector<HTMLIFrameElement>(nestedReader);
    return nested ? locateReader(nested) : { doc };
  }
  if (frame.contentWindow && frame.src.startsWith(readerOrigin + readerPath)) return { frame: frame.contentWindow };
}
