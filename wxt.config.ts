import { defineConfig } from 'wxt';

export default defineConfig({
  zip: { name: 'kexu' },
  // The toolbar popup is static HTML and CSS.
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  hooks: {
    'build:publicAssets': (wxt, files) => {
      files.push({ absoluteSrc: wxt.config.root + '/LICENSE', relativeDest: 'LICENSE' });
    },
  },
  manifest: {
    name: '课序 · 学习通续学',
    description: '在学习通网页接续视频、教材和下一小节。',
    permissions: ['storage'],
    minimum_chrome_version: '120',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  },
});
