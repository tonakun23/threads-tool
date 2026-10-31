/**
 * Cào 1 bài Threads + các bình luận (replies) bằng Playwright.
 * Tái dùng chiến lược của src/utils/parser.ts: tìm link /post/, đi ngược
 * lên container có nút thống kê, đọc text trong div[dir="auto"].
 *
 * Chỉ lấy dữ liệu công khai, có delay + cuộn từ từ (đừng spam request).
 * Chạy: node scraper.js "<url>" <maxComments>
 * In ra JSON { post, comments } lên stdout. Lỗi in ra stderr + exit 1.
 */
import { readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseNum = (s) => {
  if (!s) return 0;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KkMm]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2].toLowerCase() === 'k') n *= 1000;
  if (m[2].toLowerCase() === 'm') n *= 1000000;
  return Math.round(n);
};

function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) throw new Error('Thiếu URL bài viết Threads.');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!/threads\.(com|net)/i.test(u)) throw new Error('URL phải là threads.com / threads.net.');
  return u.replace('threads.net', 'threads.com');
}

const url = normalizeUrl(process.argv[2] || '');
const maxComments = Math.max(1, Math.min(50, parseInt(process.argv[3] || '20', 10) || 20));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Chưa cài playwright. Chạy trong apps/studio: npm install playwright && npx playwright install chromium');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 1400 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    locale: 'vi-VN',
  });
  const page = await context.newPage();
  // Chặn tài nguyên nặng cho nhanh, giống blockHeavyResources của toolkit.
  await page.route('**/*.{woff,woff2,mp4,webm}', (route) => route.abort());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  try {
    await page.waitForSelector('a[href*="/post/"]', { timeout: 20000 });
  } catch {
    const body = (await page.content()).slice(0, 400);
    if (/log in|đăng nhập/i.test(body)) throw new Error('Threads hiện tường đăng nhập (login wall). Thử lại sau, hoặc dán JSON dataset của toolkit / dùng dữ liệu demo.');
    throw new Error('Không tải được bài viết. Kiểm tra lại link (bài công khai, còn tồn tại).');
  }
  // Cuộn từ từ để tải replies, tối đa ~12 lần, mỗi lần nghỉ 1.2s.
  for (let i = 0; i < 12; i++) {
    const before = await page.locator('a[href*="/post/"]').count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1200);
    const after = await page.locator('a[href*="/post/"]').count();
    if (after >= maxComments + 1 && after === before) break;
  }

  const posts = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    const links = Array.from(document.querySelectorAll('a[href*="/post/"]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/);
      if (!m || seen.has(m[2])) continue;
      seen.add(m[2]);
      // Đi ngược lên container có >=2 nút thống kê.
      let el = link.parentElement, depth = 0, container = null;
      while (el && depth < 15) {
        const btns = el.querySelectorAll('div[role="button"]');
        let stats = 0;
        for (const b of btns) {
          const t = b.textContent || '';
          if (/like|comment|repost|share|thích|bình luận|chia sẻ/i.test(t)) stats++;
        }
        if (stats >= 2) { container = el; break; }
        el = el.parentElement; depth++;
      }
      if (!container) continue;
      const username = m[1];
      const nameLink = container.querySelector(`a[href="/@${username}"]`);
      const displayName = (nameLink?.textContent || username).trim();
      const avatar = container.querySelector('img[alt*="profile"], img[alt*="avatar"]');
      const texts = [];
      for (const tEl of container.querySelectorAll('div[dir="auto"], span[dir="auto"]')) {
        if (tEl.closest('[role="button"]') || tEl.closest('a')) continue;
        const t = (tEl.textContent || '').trim();
        if (t.length > 3 && t !== username && t !== displayName && !/^\d+[mhd]$/.test(t) && !/^[\d,]+$/.test(t)) texts.push(t);
      }
      let content = texts.join('\n\n').replace(/\s*(Learn more|Translate)\s*$/i, '').trim();
      const timeEl = container.querySelector('time');
      let likes = 0, replies = 0, reposts = 0, shares = 0;
      for (const b of container.querySelectorAll('div[role="button"]')) {
        const label = (b.getAttribute('aria-label') || b.textContent || '');
        const num = (label.match(/[\d,.]+[KkMm]?/) || ['0'])[0];
        const v = (() => { const x = parseFloat(num.replace(/,/g, '')); return num.toLowerCase().endsWith('k') ? x * 1000 : num.toLowerCase().endsWith('m') ? x * 1e6 : x; })();
        if (/like|thích/i.test(label) && !likes) likes = Math.round(v);
        else if (/comment|repl|bình luận/i.test(label) && !replies) replies = Math.round(v);
        else if (/repost/i.test(label) && !reposts) reposts = Math.round(v);
        else if (/share|chia sẻ/i.test(label) && !shares) shares = Math.round(v);
      }
      out.push({
        id: m[2],
        url: href.startsWith('http') ? href : 'https://www.threads.com' + href,
        author: { username, displayName, profileUrl: 'https://www.threads.com/@' + username, avatarUrl: avatar?.getAttribute('src') || undefined },
        content,
        timestamp: timeEl?.getAttribute('datetime') || timeEl?.textContent || '',
        stats: { likes, replies, reposts, shares },
      });
    }
    return out;
  });

  const valid = posts.filter((p) => p.content && p.content.length > 3);
  if (!valid.length) throw new Error('Cào được trang nhưng không trích xuất được nội dung bài nào (Threads đổi giao diện?). Dùng chế độ dán JSON hoặc demo.');
  const post = valid[0];
  const comments = valid.slice(1)
    .filter((c) => c.id !== post.id)
    .sort((a, b) => (b.stats.likes + b.stats.replies * 3) - (a.stats.likes + a.stats.replies * 3))
    .slice(0, maxComments);
  console.log(JSON.stringify({ post, comments, source: 'live', scrapedUrl: page.url() }));
} finally {
  await browser.close();
}
