/**
 * Chụp thẻ Threads chính thức từ mã embed ("Get embed code").
 *
 * Dùng đúng cấu trúc blockquote mà Threads sinh ra (Tony gửi 31/10):
 *   <blockquote class="text-post-media"
 *     data-text-post-permalink="<permalink>" data-text-post-version="0"
 *     id="ig-tp-<postId>" style=" background:#FFF; ... max-width:650px; ...">
 *     ...nội dung dự phòng "View on Threads"...
 *   </blockquote>
 *   <script async src="https://www.threads.com/embed.js"></script>
 * embed.js sẽ biến blockquote thành thẻ bài thật (thường là iframe).
 * Cần: npm install playwright && npx playwright install chromium
 * (chung với cào live). Không cần đăng nhập Threads.
 *
 * Chạy 1 URL:  node embed-shot.js --url <postUrl> --out card.png
 * Chạy hàng loạt: node embed-shot.js --manifest jobs.json --out-dir dir
 *   jobs.json: [{id, url}, ...] -> in JSON [{id, ok, out, error}]
 * Tự kiểm tra (không cần trình duyệt): node embed-shot.js --self-test
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EMBED_JS = 'https://www.threads.com/embed.js';

// Logo Threads trong nội dung dự phòng, lấy nguyên từ mã embed thật.
const THREADS_SVG = '<svg aria-label="Threads" height="32px" role="img" viewBox="0 0 192 192" width="32px" xmlns="http://www.w3.org/2000/svg"> <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.537 60.5382 122.616 44.905 97.5619 44.745C97.4484 44.7443 97.3355 44.7443 97.222 44.7443C82.2364 44.7443 69.7731 51.1409 62.102 62.7807L75.881 72.2328C81.6116 63.5383 90.6052 61.6848 97.2286 61.6848C97.3051 61.6848 97.3819 61.6848 97.4576 61.6855C105.707 61.7381 111.932 64.1366 115.961 68.814C118.893 72.2193 120.854 76.925 121.825 82.8638C114.511 81.6207 106.601 81.2385 98.145 81.7233C74.3247 83.0954 59.0111 96.9879 60.0396 116.292C60.5615 126.084 65.4397 134.508 73.775 140.011C80.8224 144.663 89.899 146.938 99.3323 146.423C111.79 145.74 121.563 140.987 128.381 132.296C133.559 125.696 136.834 117.143 138.28 106.366C144.217 109.949 148.617 114.664 151.047 120.332C155.179 129.967 155.42 145.8 142.501 158.708C131.182 170.016 117.576 174.908 97.0135 175.059C74.2042 174.89 56.9538 167.575 45.7381 153.317C35.2355 139.966 29.8077 120.682 29.6052 96C29.8077 71.3178 35.2355 52.0336 45.7381 38.6827C56.9538 24.4249 74.2039 17.11 97.0132 16.9405C119.988 17.1113 137.539 24.4614 149.184 38.788C154.894 45.8136 159.199 54.6488 162.037 64.9503L178.184 60.6422C174.744 47.9622 169.331 37.0357 161.965 27.974C147.036 9.60668 125.202 0.195148 97.0695 0H96.9569C68.8816 0.19447 47.2921 9.6418 32.7883 28.0793C19.8819 44.4864 13.2244 67.3157 13.0007 95.9325L13 96L13.0007 96.0675C13.2244 124.684 19.8819 147.514 32.7883 163.921C47.2921 182.358 68.8816 191.806 96.9569 192H97.0695C122.03 191.827 139.624 185.292 154.118 170.811C173.081 151.866 172.51 128.119 166.26 113.541C161.776 103.087 153.227 94.5962 141.537 88.9883ZM98.4405 129.507C88.0005 130.095 77.1544 125.409 76.6196 115.372C76.2232 107.93 81.9158 99.626 99.0812 98.6368C101.047 98.5234 102.976 98.468 104.871 98.468C111.106 98.468 116.939 99.0737 122.242 100.233C120.264 124.935 108.662 128.946 98.4405 129.507Z" /></svg>';

export function postIdFromUrl(raw) {
  const m = String(raw || '').match(/\/post\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function embedHtml(permalink) {
  const id = postIdFromUrl(permalink);
  if (!id) throw new Error('URL không phải link bài Threads (thiếu /post/<id>).');
  const esc = String(permalink).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>html,body{margin:0;padding:0;background:#fff}</style></head><body>'
    + '<blockquote class="text-post-media" data-text-post-permalink="' + esc + '" data-text-post-version="0" id="ig-tp-' + id + '" style=" background:#FFF; border-width: 1px; border-style: solid; border-color: #00000026; border-radius: 16px; max-width:650px; margin: 1px; min-width:270px; padding:0; width:99.375%; width:-webkit-calc(100% - 2px); width:calc(100% - 2px);">'
    + ' <a href="' + esc + '" style=" background:#FFFFFF; line-height:0; padding:0 0; text-align:center; text-decoration:none; width:100%; font-family: -apple-system, BlinkMacSystemFont, sans-serif;" target="_blank">'
    + ' <div style=" padding: 40px; display: flex; flex-direction: column; align-items: center;"><div style=" display:block; height:32px; width:32px; padding-bottom:20px;"> ' + THREADS_SVG + '</div>'
    + '<div style=" font-size: 15px; line-height: 21px; color: #000000; font-weight: 600; "> View on Threads</div></div></a></blockquote>'
    + '<script async src="' + EMBED_JS + '"></script>'
    + '</body></html>';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shootOne(browser, url, outPath) {
  const page = await browser.newPage({
    viewport: { width: 700, height: 1000 },
    deviceScaleFactor: 2,
  });
  try {
    await page.setContent(embedHtml(url), { waitUntil: 'load', timeout: 30000 });
    // Chờ embed.js render: iframe xuất hiện, hoặc blockquote hết dạng
    // dự phòng (chỉ còn "View on Threads").
    try {
      await page.waitForFunction(() => {
        const f = document.querySelector('iframe');
        if (f && f.offsetHeight > 100) return true;
        const bq = document.querySelector('blockquote.text-post-media');
        if (!bq) return true; // embed.js đã thay blockquote bằng thẻ khác
        const t = (bq.textContent || '').trim();
        return bq.querySelectorAll('*').length > 3 && t !== '' && t !== 'View on Threads' && bq.offsetHeight > 200;
      }, { timeout: 25000 });
    } catch {
      // Hết giờ chờ: chụp cái đang có rồi kiểm tra bên dưới.
    }
    await sleep(800);
    const rendered = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      if (f) return f.offsetHeight > 100;
      const bq = document.querySelector('blockquote.text-post-media');
      if (!bq) return true;
      const t = (bq.textContent || '').trim();
      return t !== '' && t !== 'View on Threads';
    });
    if (!rendered) {
      throw new Error('embed.js không render được thẻ (mạng tới Threads bị chặn, hoặc bài không công khai).');
    }
    const frames = page.locator('iframe');
    const el = (await frames.count()) ? frames.first()
      : page.locator('blockquote.text-post-media').first();
    await el.screenshot({ path: outPath });
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
    const html = embedHtml('https://www.threads.com/@eli2122/post/DfHxdxMkjEi');
    const checks = [
      html.includes('data-text-post-permalink="https://www.threads.com/@eli2122/post/DfHxdxMkjEi"'),
      html.includes('id="ig-tp-DfHxdxMkjEi"'),
      html.includes('src="https://www.threads.com/embed.js"'),
      html.includes('max-width:650px'),
      html.includes('background:#FFF'),
      html.includes('View on Threads'),
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

  let jobs;
  let outDir;
  if (arg('--manifest')) {
    jobs = JSON.parse(readFileSync(arg('--manifest'), 'utf8'));
    outDir = arg('--out-dir');
    mkdirSync(outDir, { recursive: true });
  } else if (arg('--url') && arg('--out')) {
    jobs = [{ id: 'one', url: arg('--url') }];
    outDir = null;
  } else {
    console.error('Dùng: node embed-shot.js --url <postUrl> --out card.png  |  --manifest jobs.json --out-dir dir  |  --self-test');
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const results = [];
  const concurrency = Math.max(1, Math.min(4, parseInt(arg('--concurrency') || '3', 10) || 3));
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const outPath = outDir ? join(outDir, job.id + '.png') : arg('--out');
      try {
        await shootOne(browser, job.url, outPath);
        results.push({ id: job.id, ok: true, out: outPath });
      } catch (e) {
        results.push({ id: job.id, ok: false, error: e?.message || String(e) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  await browser.close();
  // Giữ đúng thứ tự manifest.
  const byId = new Map(results.map((r) => [r.id, r]));
  const ordered = jobs.map((j) => byId.get(j.id));
  if (arg('--manifest')) {
    console.log(JSON.stringify(ordered));
    if (ordered.some((r) => !r.ok)) {
      for (const r of ordered.filter((r) => !r.ok)) console.error('embed-shot thất bại ' + r.id + ': ' + r.error);
    }
  } else {
    const r = ordered[0];
    if (!r.ok) { console.error(r.error); process.exit(1); }
    console.log(JSON.stringify(r));
  }
}

await main();
