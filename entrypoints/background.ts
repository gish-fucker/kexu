import { browser } from 'wxt/browser';
import { getCoursePage } from '../lib/course-page';
import { type TabMessage, type TabMutedUpdate, type Transition, type TransitionMessage, transitionLifetime } from '../lib/transition';

export default defineBackground(() => {
  const pending = new Map<string, Promise<unknown>>();
  const keyFor = (tabId: number) => 'next-chapter-' + tabId;

  function inOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
    pending.set(key, next);
    const release = () => {
      if (pending.get(key) === next) pending.delete(key);
    };
    void next.then(release, release);
    return next;
  }

  browser.runtime.onMessage.addListener((message: TransitionMessage | TabMessage, sender, respond) => {
    if (!sender.url || sender.frameId !== 0 || sender.tab?.id === undefined) return;
    const page = getCoursePage(new URL(sender.url));
    if (!page || !message) return;

    if (message.kind === 'next-background-step') {
      // Pace the next course operation outside the hidden document's timer queue.
      setTimeout(() => respond(true), 1000);
      return true;
    }

    const tabId = sender.tab.id;
    const key = keyFor(tabId);
    if (message.kind === 'get-muted' || message.kind === 'toggle-muted') {
      void inOrder(key, async () => {
        const tab = await browser.tabs.get(tabId);
        const muted = tab.mutedInfo?.muted ?? null;
        if (message.kind === 'get-muted' || muted === null) return muted;
        const updated = await browser.tabs.update(tabId, { muted: !muted });
        return updated?.mutedInfo?.muted ?? null;
      }).then(respond, () => respond(null));
      return true;
    }
    if (!['expect-next', 'take-next', 'cancel-next'].includes(message.kind)) return;
    const storage = browser.storage.session;
    void inOrder(key, async () => {
      if (message.kind === 'expect-next') {
        const { transition } = message;
        if (transition.course !== page.course || !/^\d+$/.test(transition.chapter)
          || transition.expiresAt > Date.now() + transitionLifetime) return false;
        await storage.set({ [key]: transition });
        return true;
      }
      const saved = (await storage.get(key))[key] as Transition | undefined;
      if (!saved) return false;
      if (message.kind === 'cancel-next') {
        if (saved.id === message.id) await storage.remove(key);
        return false;
      }
      await storage.remove(key);
      if (saved.expiresAt < Date.now() || saved.course !== page.course) return false;
      return saved.chapter === page.chapter;
    }).then(respond, () => respond(false));
    return true;
  });

  browser.tabs.onUpdated.addListener((tabId, change) => {
    const muted = change.mutedInfo?.muted;
    if (muted === undefined) return;
    const message: TabMutedUpdate = { kind: 'tab-muted-changed', muted };
    void browser.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {});
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    const key = keyFor(tabId);
    void inOrder(key, () => browser.storage.session.remove([key, key + '-refresh'])).catch(() => {});
  });
});
