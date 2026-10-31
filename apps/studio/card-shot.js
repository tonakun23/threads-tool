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

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Số rút gọn kiểu Việt Nam, cùng quy ước với threads-parse.js:
// 10800 -> 10,8K · 1400 -> 1,4K · 1000000 -> 1M.
export function formatCompact(n) {
  const v = Number(n) || 0;
  const trim = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
  if (v >= 1e9) return trim(v / 1e9) + 'B';
  if (v >= 1e6) return trim(v / 1e6) + 'M';
  if (v >= 1e3) return trim(v / 1e3) + 'K';
  return String(v);
}

export function avatarLetter(username) {
  const m = String(username || '').match(/[A-Za-z0-9À-ỹ]/);
  return (m ? m[0] : '?').toUpperCase();
}

export function avatarColor(username) {
  let h = 0;
  for (const ch of String(username || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 65% 55%)`;
}

const ICONS = {
  likes: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  replies: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  reposts: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  shares: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
};

function itemHtml(it, idx) {
  const a = it.author || {};
  const username = a.username || 'unknown';
  const stats = it.stats || {};
  const avatarUrl = String(a.avatarUrl || '');
  const avatar = avatarUrl
    ? `<span class="avatar" style="background:${avatarColor(username)}"><span class="avatar-letter">${esc(avatarLetter(username))}</span><img src="${esc(avatarUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
    : `<span class="avatar" style="background:${avatarColor(username)}"><span class="avatar-letter">${esc(avatarLetter(username))}</span></span>`;
  const verified = a.isVerified ? '<span class="verified">✓</span>' : '';
  const time = it.timeLabel ? `<span class="time">${esc(it.timeLabel)}</span>` : '';
  const statRow = ['likes', 'replies', 'reposts', 'shares']
    .map((k) => `<span class="stat">${ICONS[k]}<span>${esc(formatCompact(stats[k]))}</span></span>`).join('');
  return `<div class="item${idx > 0 ? ' reply' : ''}">`
    + `<div class="avatar-col">${avatar}</div>`
    + `<div class="main-col"><div class="head"><span class="name">@${esc(username)}</span>${verified}${time}</div>`
    + `<div class="content">${esc(it.content || '')}</div>`
    + `<div class="stats">${statRow}</div></div></div>`;
}

export function cardHtml(items) {
  const list = (Array.isArray(items) && items.length ? items : [{ author: { username: 'unknown' }, content: '' }]);
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>'
    + 'html,body{margin:0;padding:0;background:#000}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}'
    + '#card{width:980px;box-sizing:border-box;background:#141414;color:#fff;border:1px solid #333;border-radius:28px;padding:40px 44px;position:relative}'
    + '.logo{position:absolute;top:34px;right:44px;width:48px;height:48px;border:3px solid #d4d4d4;border-radius:50%;color:#fff;font-size:30px;font-weight:700;display:flex;align-items:center;justify-content:center}'
    + '.item{display:flex;gap:18px;margin-bottom:28px}.item:last-child{margin-bottom:0}'
    + '.item.reply{margin-left:58px;padding-left:20px;border-left:3px solid #4a4a4a}'
    + '.avatar-col{flex:0 0 auto}'
    + '.avatar{position:relative;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;overflow:hidden;color:#fff;font-size:34px;font-weight:700}'
    + '.reply .avatar{width:56px;height:56px;font-size:26px}'
    + '.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
    + '.main-col{flex:1;min-width:0;padding-right:70px}'
    + '.reply .main-col{padding-right:0}'
    + '.head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}'
    + '.name{font-size:34px;font-weight:700;line-height:1.2}'
    + '.reply .name{font-size:30px}'
    + '.verified{color:#3797ef;font-size:26px;font-weight:700}'
    + '.time{color:#a3a3a3;font-size:28px}'
    + '.content{font-size:38px;line-height:1.45;white-space:pre-wrap;overflow-wrap:break-word}'
    + '.reply .content{font-size:34px}'
    + '.stats{display:flex;gap:34px;margin-top:18px;color:#d4d4d4}'
    + '.stat{display:flex;align-items:center;gap:9px;font-size:27px}'
    + '.stat svg{width:27px;height:27px}'
    + '</style></head><body>'
    + '<div id="card"><div class="logo">@</div>'
    + list.map(itemHtml).join('')
    + '</div></body></html>';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shootOne(browser, job, outPath) {
  const page = await browser.newPage({
    viewport: { width: 980, height: 800 },
    deviceScaleFactor: 2,
  });
  try {
    await page.setContent(cardHtml(job.items), { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Cho avatar tải xong (tối đa ~1,2s); ảnh lỗi đã có chữ cái dự phòng.
    await sleep(1200);
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
