// Бейкер спрайтов: node tools/bake_sprites.mjs [имя ...]
// Нужно: запущенный `python3 -m http.server 8000` в корне проекта, Playwright, three в tools/bake/node_modules
// (cd tools/bake && npm install). Пишет assets/sprites/<имя>.png и <имя>.json.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JOBS } from './bake/jobs.mjs';

// Playwright: локальный пакет или глобальная установка
const { chromium } = await import('playwright').catch(() => import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/sprites');
fs.mkdirSync(OUT, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOBS);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
page.on('console', (m) => { if (m.type() !== 'log' || process.env.VERBOSE) console.log('LOG', m.text()); });
await page.goto('http://localhost:8000/tools/bake/bake.html');
await page.waitForFunction(() => window.bakeReady, null, { timeout: 60000 });
if (process.env.VERBOSE) await page.evaluate(() => { window.DEBUG = true; });

for (const name of names) {
  const job = { name, ...JOBS[name] };
  const t0 = Date.now();
  // функции не передаются в браузер — только данные
  const res = await page.evaluate((j) => window.bakeJob(j), JSON.parse(JSON.stringify(job)));
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(res.png.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(res.meta, null, 1));
  console.log(`${name}: ${res.meta.cell.join('×')} × ${res.meta.frames} кадров, палитра ${res.meta.palette}, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}
await browser.close();
