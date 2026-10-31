/**
 * Dựng lại thẻ bình luận giống giao diện Threads bản tối bằng HTML/CSS
 * rồi chụp thành ảnh PNG bằng Playwright (Chromium).
 *
 * Hướng này không phụ thuộc embed.js hay trang Threads: dữ liệu đã cào
 * (tác giả, avatar, giờ, nội dung, số liệu) được vẽ lại theo đúng bố cục
 * Threads — avatar tròn, tên + giờ, nội dung, hàng số liệu, reply thụt
 * vào có kẻ dọc — và luôn ra thẻ tối như video mẫu Tony gửi.
 * Avatar là ảnh thật (avatarUrl); tải lỗi thì hiện chữ cái như trước.
 * Cần: npm install playwright && npx playwright install chromium
 * (chung với cào live). Chụp lỗi thì render rơi về thẻ vẽ tay.
 *
 * Chạy hàng loạt: node card-shot.js --manifest jobs.json --out-dir dir
 *   jobs.json: [{id, items:[{author, content, timeLabel, stats, depth}]}]
 *   -> in JSON [{id, ok, out, error}]
 * Tự kiểm tra (không cần trình duyệt): node card-shot.js --self-test
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cardHtml, formatCompact } from './card-html.js';

async function shootOne(browser, job, outPath) {
  const page = await browser.newPage({
    viewport: { width: 980, height: 800 },
    deviceScaleFactor: 2,
  });
  try {
    await page.setContent(cardHtml(job.items), { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Cho avatar tải xong (tối đa ~1,2s, xong sớm thì thôi); ảnh lỗi
    // đã có chữ cái dự phòng nên chờ lâu hơn cũng không ích gì.
    await page.waitForLoadState('networkidle', { timeout: 1200 }).catch(() => {});
    const card = page.locator('#card');
    await card.screenshot({ path: outPath });
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--self-test')) {
    const html = cardHtml([
      { author: { username: 'eli2122', displayName: 'eli2122', isVerified: true, avatarUrl: 'https://example.com/a.jpg' }, content: 'MÁY FARM CÔNG ĐỨC', timeLabel: '22 giờ', stats: { likes: 10800, replies: 1400, reposts: 2500000, shares: 48 }, depth: 0 },
      { author: { username: 'ban_b', isVerified: false }, content: 'Trả lời hay quá', timeLabel: '19 giờ', stats: { likes: 5, replies: 0, reposts: 0, shares: 0 }, depth: 1 },
    ]);
    const checks = [
      html.includes('@eli2122'),
      html.includes('MÁY FARM CÔNG ĐỨC'),
      html.includes('10,8K') && html.includes('1,4K') && html.includes('2,5M') && html.includes('>48<'),
      html.includes('https://example.com/a.jpg'),
      html.includes('class="item reply"'),
      html.includes('background:#141414'),
      html.includes('<svg'),
      formatCompact(10800) === '10,8K' && formatCompact(1400) === '1,4K' && formatCompact(1000000) === '1M' && formatCompact(48) === '48',
    ];
    console.log(JSON.stringify({ ok: checks.every(Boolean), checks }));
    process.exit(checks.every(Boolean) ? 0 : 1);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Chưa cài playwright. Chạy trong apps/studio: npm install playwright && npx playwright install chromium');
    process.exit(2);
  }

  if (!arg('--manifest') || !arg('--out-dir')) {
    console.error('Dùng: node card-shot.js --manifest jobs.json --out-dir dir  |  --self-test');
    process.exit(2);
  }
  const jobs = JSON.parse(readFileSync(arg('--manifest'), 'utf8'));
  const outDir = arg('--out-dir');
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const results = [];
  const concurrency = Math.max(1, Math.min(4, parseInt(arg('--concurrency') || '3', 10) || 3));
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const outPath = join(outDir, job.id + '.png');
      try {
        await shootOne(browser, job, outPath);
        results.push({ id: job.id, ok: true, out: outPath });
      } catch (e) {
        results.push({ id: job.id, ok: false, error: e?.message || String(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  await browser.close();
  const byId = new Map(results.map((r) => [r.id, r]));
  const ordered = jobs.map((j) => byId.get(j.id));
  console.log(JSON.stringify(ordered));
  for (const r of ordered.filter((r) => !r.ok)) console.error('card-shot thất bại ' + r.id + ': ' + r.error);
}

await main();
