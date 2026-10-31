/**
 * Cào 1 bài Threads + các bình luận (replies) bằng Playwright.
 * Logic trích xuất nằm ở threads-parse.js (dùng chung cho test jsdom):
 * 1 bài = 1 đơn vị div[tabindex="0"], giữ thứ tự trang, giữ chuỗi
 * trả lời lồng nhau qua parentId/depth, lọc lượt xem/giờ/nhãn.
 *
 * Chỉ lấy dữ liệu công khai, có delay + cuộn từ từ (đừng spam request).
 * Chạy: node scraper.js "<url>" <maxComments>
 * In ra JSON { post, comments } lên stdout. Lỗi in ra stderr + exit 1.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// threads-parse.js là module thuần, không import gì: bỏ từ khóa export
// để chạy được trong trang qua page.evaluate (chuỗi).
const parseSrc = readFileSync(join(HERE, 'threads-parse.js'), 'utf8')
  .replace(/^export\s+/gm, '')
  .replace(/^import[^;]+;$/gm, '');
const EXTRACT_EXPR = `(function () { ${parseSrc}; return extractPosts(document); })()`;

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

  const posts = await page.evaluate(EXTRACT_EXPR);

  const valid = posts.filter((p) => p.content && p.content.length > 3);
  if (!valid.length) throw new Error('Cào được trang nhưng không trích xuất được nội dung bài nào (Threads đổi giao diện?). Dùng chế độ dán JSON hoặc demo.');
  const post = valid[0];
  // GIỮ NGUYÊN THỨ TỰ TRÊN TRANG (hội thoại), không sắp xếp theo like:
  // sắp xếp lại làm đứt chuỗi trả lời cha-con trong video mẫu.
  const comments = valid.slice(1)
    .filter((c) => c.id !== post.id)
    .slice(0, maxComments);
  console.log(JSON.stringify({ post, comments, source: 'live', scrapedUrl: page.url() }));
} finally {
  await browser.close();
}
