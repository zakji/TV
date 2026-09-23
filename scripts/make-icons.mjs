// Renders app/icons/icon.svg to the PNG sizes iOS/Android need (uses Playwright's Chromium).
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../scraper/package.json', import.meta.url));
const { chromium } = require('playwright');
const svg = await readFile(new URL('../app/icons/icon.svg', import.meta.url), 'utf8');
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
for (const [name, size, pad] of [['apple-touch-icon', 180, 0], ['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.1]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#05060d"><div style="width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:${size * (1 - pad * 2)}px;height:${size * (1 - pad * 2)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body>`);
  await page.screenshot({ path: new URL(`../app/icons/${name}.png`, import.meta.url).pathname });
}
await browser.close();
console.log('icons written');
