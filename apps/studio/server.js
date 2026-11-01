/**
 * Studio server — chỉ dùng module có sẵn của Node, không cần npm install
 * để chạy UI + render (render cần Python + Pillow + FFmpeg hệ thống).
 * Cào live cần thêm: npm install playwright && npx playwright install chromium
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cardHtml } from './card-html.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE);
const UPLOADS = join(ROOT, 'uploads');
const OUT = join(ROOT, 'out');
const JOBS = join(ROOT, 'jobs');
const EMBED_PREVIEW = join(ROOT, 'embed-preview');
const CARD_PREVIEW = join(ROOT, 'card-preview');
const DEBUG_DIR = join(ROOT, 'debug');
for (const d of [UPLOADS, OUT, JOBS]) mkdirSync(d, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };
const VOICES = [
  { id: 'vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ)', gender: 'Nữ' },
  { id: 'vi-VN-NamMinhNeural', label: 'Nam Minh (Nam)', gender: 'Nam' },
];
const jobs = new Map();

// Chromium giữ sống cho chụp thẻ replica ở khung xem trước: trước đây
// mỗi lần chụp là một tiến trình Node mới + một lần mở Chromium mới,
// tốn vài giây nên khung xem trước dựng thẻ thật rất chậm. Giữ một
// trình duyệt chung trong tiến trình server, mỗi lần chụp chỉ mở một
// tab mới rồi đóng — lần chụp sau nhanh hơn hẳn lần đầu. Trình duyệt
// kẹt thì bỏ hẳn để lần sau mở lại từ đầu.
let cardBrowser = null;
let cardBrowserStarting = null;
async function getCardBrowser() {
  if (cardBrowser) return cardBrowser;
  if (!cardBrowserStarting) {
    cardBrowserStarting = (async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run'] });
      cardBrowser = browser;
      return browser;
    })().catch((e) => { cardBrowserStarting = null; throw e; });
  }
  return cardBrowserStarting;
}
async function shootCardPng(items, outPath) {
  const browser = await getCardBrowser();
  const page = await browser.newPage({ viewport: { width: 980, height: 800 }, deviceScaleFactor: 2 });
  try {
    await page.setContent(cardHtml(items), { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Cho avatar tải xong (tối đa ~1,2s, xong sớm thì thôi); ảnh lỗi
    // đã có chữ cái dự phòng nên chờ lâu hơn cũng không ích gì.
    await page.waitForLoadState('networkidle', { timeout: 1200 }).catch(() => {});
    await page.locator('#card').screenshot({ path: outPath });
  } catch (e) {
    try { await page.close().catch(() => {}); } catch { /* bỏ qua */ }
    try { await browser.close().catch(() => {}); } catch { /* bỏ qua */ }
    if (cardBrowser === browser) cardBrowser = null;
    throw e;
  }
  await page.close().catch(() => {});
}

function send(res, code, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' });
  res.end(body);
}
function safeName(name) {
  return String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file';
}
function kindOf(name) {
  const e = extname(name).toLowerCase();
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(e)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.ogg'].includes(e)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(e)) return 'image';
  return 'file';
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 300 * 1024 * 1024) { reject(new Error('File quá lớn (tối đa 300MB).')); req.destroy(); } chunks.push(c); });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// Multipart tối giản: đủ cho 1 file + vài field text, không dùng dependency.
function parseMultipart(buf, boundary) {
  const parts = [];
  const sep = Buffer.from('--' + boundary);
  let start = buf.indexOf(sep);
  while (start !== -1) {
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = buf.subarray(start, headerEnd).toString('utf8');
    const next = buf.indexOf(sep, headerEnd + 4);
    if (next === -1) break;
    const data = buf.subarray(headerEnd + 4, next - 2); // bỏ \r\n trước boundary
    const nameM = headers.match(/name="([^"]+)"/);
    const fileM = headers.match(/filename="([^"]*)"/);
    parts.push({ name: nameM?.[1], filename: fileM?.[1] || null, data, headers });
    start = next;
  }
  return parts;
}
function normalizeDataset(raw) {
  // Chấp nhận: {post, comments} | [post, reply, ...] | {items:[...]}
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (Array.isArray(raw?.items)) items = raw.items;
  else if (raw?.post) return { post: raw.post, comments: raw.comments || [] };
  else throw new Error('JSON không đúng dạng dataset của toolkit (cần mảng các post, hoặc {post, comments}).');
  const posts = items.filter((p) => p && p.content && p.author).map((p) => ({
    id: String(p.id || ''),
    url: p.url || '',
    author: { username: p.author.username || 'unknown', displayName: p.author.displayName || p.author.username || 'unknown', profileUrl: p.author.profileUrl || '', avatarUrl: p.author.avatarUrl, isVerified: !!p.author.isVerified },
    content: String(p.content || ''),
    timestamp: p.timestamp || '',
    timeLabel: p.timeLabel || '',
    parentId: p.parentId || null,
    depth: Number(p.depth || 0),
    stats: { likes: p.stats?.likes || 0, replies: p.stats?.replies || 0, reposts: p.stats?.reposts || 0, shares: p.stats?.shares || 0 },
  }));
  if (!posts.length) throw new Error('Không có bài nào hợp lệ trong JSON đã dán.');
  const main = posts.find((p) => !p.source) || posts[0];
  // Giữ nguyên thứ tự trong JSON (thứ tự hội thoại), không sắp theo like.
  const comments = posts.filter((p) => p.id !== main.id);
  return { post: main, comments };
}

// Lấy link bài Threads từ mã embed đã dán (giống parseEmbedCode ở
// public/app.js): ưu tiên data-text-post-permalink, rồi tới href tới
// /post/ trong mã. Không phải mã embed thì trả ''.
function parseEmbedCode(code) {
  const s = String(code || '');
  const m = s.match(/data-text-post-permalink=["']([^"']+)["']/i)
    || s.match(/href=["'](https?:\/\/[^"']*\/post\/[^"']*)["']/i);
  const url = m ? m[1] : '';
  return /^https?:\/\//.test(url) && /threads\.(com|net)/i.test(url) && url.includes('/post/') ? url : '';
}

// Chọn N bình luận nhiều tim nhất (Tony 01/11: xếp theo số tim),
// tim bằng nhau thì lấy tổng tương tác cao hơn, rồi trả về theo
// đúng thứ tự trên trang để chuỗi hội thoại giữ nguyên vẹn.
// Bình luận chưa có số liệu (stats 0) thì giữ thứ tự trang
// (sort ổn định).
function selectTopComments(comments, n) {
  const list = Array.isArray(comments) ? comments : [];
  if (list.length <= n) return list;
  const likes = (c) => (c.stats?.likes || 0);
  const total = (c) => {
    const s = c.stats || {};
    return (s.likes || 0) + (s.replies || 0) + (s.reposts || 0) + (s.shares || 0);
  };
  const picked = new Set(list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => likes(b.c) - likes(a.c) || total(b.c) - total(a.c) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.i));
  return list.filter((_, i) => picked.has(i));
}

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      createReadStream(join(ROOT, 'public', 'index.html')).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/static/')) {
      const f = join(ROOT, 'public', basename(p));
      if (!existsSync(f)) { send(res, 404, { error: 'Không tìm thấy file.' }); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/uploads/')) {
      // Chỉ phục vụ file đã tải lên qua /api/upload, lấy theo basename để khỏi đi ra ngoài thư mục uploads.
      const f = join(UPLOADS, basename(decodeURIComponent(p)));
      if (!existsSync(f)) { send(res, 404, { error: 'Không tìm thấy file đã tải lên.' }); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(f).toLowerCase()] || 'application/octet-stream' });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/embed-preview/')) {
      // Ảnh chụp thẻ embed đã lưu theo postId, lấy theo basename.
      const f = join(EMBED_PREVIEW, basename(decodeURIComponent(p)));
      if (!existsSync(f)) { send(res, 404, { error: 'Chưa có ảnh thẻ embed.' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/card-preview/')) {
      const f = join(CARD_PREVIEW, basename(decodeURIComponent(p)));
      if (!existsSync(f)) { send(res, 404, { error: 'Chưa có ảnh thẻ.' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/tts-test/')) {
      // File mp3 giọng đọc thử (tạo bởi /api/tts-test), lấy theo basename.
      const f = join(OUT, basename(decodeURIComponent(p)));
      if (!existsSync(f) || !basename(p).startsWith('tts-test-')) { send(res, 404, { error: 'Không tìm thấy file giọng đọc thử.' }); return; }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/out/')) {
      const f = join(OUT, basename(p));
      if (!existsSync(f)) { send(res, 404, { error: 'Không tìm thấy video.' }); return; }
      const stat = statSync(f);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p === '/api/voices') { send(res, 200, { voices: VOICES }); return; }
    if (req.method === 'GET' && p === '/api/demo') {
      send(res, 200, JSON.parse(readFileSync(join(ROOT, 'demo-data.json'), 'utf8'))); return;
    }
    if (req.method === 'GET' && p.startsWith('/debug/')) {
      // File chẩn đoán DOM (scrape-debug-*.json): chỉ phục vụ đúng file
      // .json trong thư mục debug, lấy theo basename để khỏi dò thư mục.
      const name = basename(decodeURIComponent(p));
      const f = join(DEBUG_DIR, name);
      if (!name.endsWith('.json') || !existsSync(f)) { send(res, 404, { error: 'Không tìm thấy file chẩn đoán.' }); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"` });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/api/jobs/') && p.endsWith('/log')) {
      // Nhật ký render của 1 job (render.log): để biết giọng đọc/thẻ
      // có rơi về dự phòng không mà không cần mò thư mục jobs/.
      const parts = p.split('/').filter(Boolean);
      const id = parts[2] || '';
      if (!/^[A-Za-z0-9-]+$/.test(id)) { send(res, 404, { error: 'Không tìm thấy job.' }); return; }
      const f = join(JOBS, id, 'render.log');
      if (!existsSync(f)) { send(res, 404, { error: 'Job này chưa có nhật ký render.' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="render-${id}.log"` });
      createReadStream(f).pipe(res); return;
    }
    if (req.method === 'GET' && p.startsWith('/api/jobs/')) {
      const id = basename(p);
      const job = jobs.get(id);
      if (job) { send(res, 200, job); return; }
      const f = join(JOBS, id, 'status.json');
      if (existsSync(f)) {
        const saved = JSON.parse(readFileSync(f, 'utf8'));
        // Job do phiên bản cũ (hoặc server đã khởi động lại) lưu mà
        // chưa có cảnh báo im lặng: suy ra từ render.log lúc đọc.
        if (saved.status === 'done' && !saved.ttsWarning) {
          try {
            const logText = readFileSync(join(JOBS, id, 'render.log'), 'utf8');
            if (logText.includes('dùng im lặng')) saved.ttsWarning = 'Video có đoạn IM LẶNG vì giọng đọc không tạo được ở đoạn đó — bấm “Tải nhật ký render” bên dưới để xem lý do thật, hoặc bấm “Thử giọng đọc” để kiểm tra lại giọng trên máy này.';
          } catch { /* chưa có log thì thôi */ }
        }
        send(res, 200, saved); return;
      }
      send(res, 404, { error: 'Không tìm thấy job.' }); return;
    }
    if (req.method === 'POST' && p === '/api/upload') {
      const ct = req.headers['content-type'] || '';
      const m = ct.match(/boundary=(.+)/);
      if (!m) { send(res, 400, { error: 'Cần gửi dạng multipart/form-data.' }); return; }
      const buf = await readBody(req);
      const parts = parseMultipart(buf, m[1]);
      const filePart = parts.find((x) => x.filename);
      if (!filePart) { send(res, 400, { error: 'Chưa chọn file.' }); return; }
      const id = randomUUID();
      const name = safeName(filePart.filename);
      const dest = join(UPLOADS, `${id}-${name}`);
      writeFileSync(dest, filePart.data);
      send(res, 200, { id, name, kind: kindOf(name), size: filePart.data.length, path: dest });
      return;
    }
    if (req.method === 'POST' && p === '/api/scrape') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const mode = body.mode || 'live';
      const maxComments = Math.max(1, Math.min(50, parseInt(body.maxComments || '20', 10) || 20));
      if (mode === 'demo') {
        const demo = JSON.parse(readFileSync(join(ROOT, 'demo-data.json'), 'utf8'));
        demo.comments = selectTopComments(demo.comments, maxComments);
        send(res, 200, demo); return;
      }
      if (mode === 'paste') {
        let raw;
        try { raw = JSON.parse(body.pasteJson || ''); } catch { send(res, 400, { error: 'JSON dán vào không hợp lệ.' }); return; }
        const norm = normalizeDataset(raw);
        norm.comments = selectTopComments(norm.comments, maxComments);
        norm.source = 'paste';
        send(res, 200, norm); return;
      }
      const url = String(body.url || '').trim();
      if (!url || !/threads\.(com|net)/i.test(url)) { send(res, 400, { error: 'Dán link bài viết Threads (threads.com / threads.net).' }); return; }
      // Cào live luôn lấy tối đa 50 bình luận để chọn ra N bình luận
      // nhiều tim nhất; việc chọn làm ở selectTopComments bên dưới.
      const child = spawn(process.execPath, [join(ROOT, 'scraper.js'), url, '50'], { timeout: 150000 });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => {
        if (code !== 0) {
          // Lấy dòng lỗi có nghĩa, bỏ dòng stack trace ("at ...") và
          // dòng "Node.js v..." ở cuối — trước đây chỉ lấy dòng cuối
          // nên giao diện toàn hiện "Node.js v24.19.0", che mất nguyên nhân.
          const meaningful = err.trim().split('\n').map((l) => l.trim())
            .filter((l) => l && !/^node\.js v\d/i.test(l) && !/^at\s/i.test(l));
          const msg = meaningful.slice(-2).join(' ').slice(0, 400);
          send(res, 502, { error: (msg || 'Cào live thất bại. Thử chế độ Demo hoặc dán JSON dataset của toolkit.') });
          return;
        }
        try { const data = JSON.parse(out); data.comments = selectTopComments(data.comments, maxComments); send(res, 200, data); }
        catch { send(res, 502, { error: 'Scraper trả về dữ liệu không đọc được.' }); }
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/tts-test') {
      // Thử giọng đọc thật một câu ngắn: chạy tts.py (Edge TTS) rồi trả
      // về file mp3 để nghe thử ngay trên giao diện. Lỗi (mất mạng,
      // chưa cài edge-tts, treo quá 75 giây) trả về ok:false kèm lý do
      // thật — để biết chắc giọng đọc có chạy được trên máy này không,
      // thay vì video xuất ra im lặng mà không rõ nguyên nhân.
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const voice = String(body.voice || 'vi-VN-HoaiMyNeural');
      const text = String(body.text || 'Xin chào, đây là giọng đọc thử của Threads Comment Studio.').slice(0, 200);
      const venvPy = process.platform === 'win32' ? join(ROOT, '.venv', 'Scripts', 'python.exe') : join(ROOT, '.venv', 'bin', 'python');
      const py = existsSync(venvPy) ? venvPy : (process.platform === 'win32' ? 'python' : 'python3');
      const name = `tts-test-${randomUUID()}.mp3`;
      const outPath = join(OUT, name);
      try {
        for (const f of readdirSync(OUT)) {
          if (f.startsWith('tts-test-') && f !== name) { try { unlinkSync(join(OUT, f)); } catch { /* bỏ qua */ } }
        }
      } catch { /* bỏ qua */ }
      const child = spawn(py, [join(ROOT, 'tts.py'), '--text', text, '--voice', voice, '--rate-percent', '20', '--out', outPath],
        { timeout: 120000, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8:replace' } });
      let err = '', ttsOut = '';
      child.stdout.on('data', (d) => { ttsOut += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => {
        if (code !== 0 || !existsSync(outPath) || statSync(outPath).size <= 1000) {
          const msg = err.trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 500)
            || `tts.py thoát mã ${code}, không tạo được file giọng đọc.`;
          send(res, 200, { ok: false, error: msg, voice }); return;
        }
        const engine = (ttsOut.match(/TTS engine: (\S+)/) || [])[1] || 'edge-tts';
        const probe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath], { timeout: 10000 });
        let probeOut = '';
        probe.stdout.on('data', (d) => { probeOut += d; });
        probe.on('close', () => {
          const seconds = parseFloat(probeOut.trim()) || 0;
          send(res, 200, { ok: true, seconds: Math.round(seconds * 10) / 10, voice, engine, audioUrl: `/tts-test/${name}` });
        });
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/embed-shots') {
      // Chụp thẻ embed thật cho panel xem trước: {urls:[...]} ->
      // [{url, pngUrl, ok, error}]. Lưu theo postId để lần sau dùng lại
      // ngay, không chụp lại. Chụp lỗi thì ok:false, giao diện giữ
      // bản mô phỏng và báo lý do (vd: chưa cài playwright).
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((u) => /^https?:\/\//.test(u) && u.includes('/post/')).slice(0, 5);
      if (!urls.length) { send(res, 400, { error: 'Cần link bài Threads (/post/<id>).' }); return; }
      mkdirSync(EMBED_PREVIEW, { recursive: true });
      const postIdOf = (u) => (u.match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1] || '';
      const results = urls.map((url) => ({ url, postId: postIdOf(url), pngUrl: null, ok: false, error: '' }));
      const missing = results.filter((r) => r.postId && !existsSync(join(EMBED_PREVIEW, r.postId + '.png')));
      for (const r of results) {
        if (r.postId && existsSync(join(EMBED_PREVIEW, r.postId + '.png'))) {
          r.pngUrl = '/embed-preview/' + r.postId + '.png'; r.ok = true;
        } else if (!r.postId) {
          r.error = 'Không lấy được id bài từ link.';
        }
      }
      if (missing.length) {
        const manifestPath = join(EMBED_PREVIEW, 'manifest.json');
        writeFileSync(manifestPath, JSON.stringify(missing.map((r) => ({ id: r.postId, url: r.url }))), 'utf8');
        try {
          const shotJson = await new Promise((resolveShot, rejectShot) => {
            const child = spawn(process.execPath, [join(ROOT, 'embed-shot.js'), '--manifest', manifestPath, '--out-dir', EMBED_PREVIEW], { timeout: 150000 });
            let out = '', err = '';
            child.stdout.on('data', (d) => { out += d; });
            child.stderr.on('data', (d) => { err += d; });
            child.on('error', rejectShot);
            child.on('close', (code) => {
              if (code !== 0) rejectShot(new Error(err.trim().split('\n').pop() || 'embed-shot thất bại.'));
              else resolveShot(out);
            });
          });
          const byId = new Map(JSON.parse(shotJson).map((r) => [r.id, r]));
          for (const r of missing) {
            const shot = byId.get(r.postId);
            if (shot?.ok && existsSync(join(EMBED_PREVIEW, r.postId + '.png'))) {
              r.pngUrl = '/embed-preview/' + r.postId + '.png'; r.ok = true;
            } else {
              r.error = shot?.error || 'Không chụp được thẻ embed.';
            }
          }
        } catch (e) {
          for (const r of missing) r.error = e?.message || String(e);
        }
      }
      send(res, 200, { shots: results });
      return;
    }
    if (req.method === 'POST' && p === '/api/card-shots') {
      // Dựng thẻ replica giống Threads bản tối cho panel xem trước:
      // {items:[...]} -> {pngUrl}. Dựng lỗi thì 502 + lý do rõ ràng.
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const items = (Array.isArray(body.items) ? body.items : []).filter((it) => it && String(it.content || '').trim()).slice(0, 6);
      if (!items.length) { send(res, 400, { error: 'Cần ít nhất 1 bình luận có nội dung.' }); return; }
      mkdirSync(CARD_PREVIEW, { recursive: true });
      const id = randomUUID().slice(0, 8);
      const cleanItems = items.map((it) => ({
        author: { username: String(it.author?.username || 'unknown'), displayName: String(it.author?.displayName || it.author?.username || 'unknown'), isVerified: !!it.author?.isVerified, avatarUrl: String(it.author?.avatarUrl || '') },
        content: String(it.content || ''), timeLabel: String(it.timeLabel || ''),
        stats: { likes: Number(it.stats?.likes || 0), replies: Number(it.stats?.replies || 0), reposts: Number(it.stats?.reposts || 0), shares: Number(it.stats?.shares || 0) },
        depth: Number(it.depth || 0),
      }));
      try {
        await shootCardPng(cleanItems, join(CARD_PREVIEW, id + '.png'));
        send(res, 200, { pngUrl: '/card-preview/' + id + '.png' });
      } catch (e) {
        const msg = e?.message || String(e);
        send(res, 502, { error: /playwright|Cannot find package/i.test(msg) ? 'Chưa cài playwright. Chạy trong apps/studio: npm install playwright && npx playwright install chromium' : msg });
      }
      return;
    }
    if (req.method === 'POST' && p === '/api/render') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const segments = Array.isArray(body.segments) ? body.segments : [];
      if (!segments.length || segments.length > 30) { send(res, 400, { error: 'Cần 1–30 đoạn (bài gốc + bình luận).' }); return; }
      const settings = body.settings || {};
      const resolveUpload = (id) => {
        if (!id) return null;
        const hit = readdirSync(UPLOADS).find((f) => f.startsWith(String(id) + '-'));
        return hit ? join(UPLOADS, hit) : null;
      };
      const voiceMissing = [];
      const cleanSegments = segments.map((s) => {
        const cleanItem = (it) => ({
          author: { username: String(it.author?.username || 'unknown').slice(0, 40), displayName: String(it.author?.displayName || it.author?.username || 'unknown').slice(0, 60), isVerified: !!it.author?.isVerified, avatarUrl: String(it.author?.avatarUrl || '').slice(0, 500) },
          content: String(it.content || '').slice(0, 2000),
          ttsText: String(it.ttsText ?? it.content ?? '').slice(0, 2000),
          timeLabel: String(it.timeLabel || '').slice(0, 20),
          url: String(it.url || '').slice(0, 300),
          stats: { likes: Number(it.stats?.likes || 0), replies: Number(it.stats?.replies || 0), reposts: Number(it.stats?.reposts || 0), shares: Number(it.stats?.shares || 0) },
          depth: Number(it.depth || 0),
        });
        const items = Array.isArray(s.items) && s.items.length ? s.items.map(cleanItem) : [cleanItem(s)];
        const first = items[0];
        return {
          kind: s.kind || 'comment', author: first.author, content: first.content, ttsText: first.ttsText,
          timeLabel: first.timeLabel, stats: first.stats, url: first.url || '',
          embedCode: String(s.embedCode || '').slice(0, 5000), embedUrl: parseEmbedCode(s.embedCode || ''),
          items: items.length > 1 ? items : undefined,
          meme: s.meme?.id ? { kind: s.meme.kind || 'image', path: resolveUpload(s.meme.id), name: s.meme.name || '' } : null,
          // Âm thanh tự chèn: phân giải id upload thành đường dẫn thật
          // để render.py dùng thay giọng AI; không tìm thấy file thì
          // null và ghi chú để đoạn đó rơi về giọng AI.
          voiceAudio: (() => {
            if (!s.voiceAudio?.id) return null;
            const p = resolveUpload(s.voiceAudio.id);
            if (!p) voiceMissing.push(String(s.voiceAudio.name || s.voiceAudio.id));
            return p ? { path: p, name: String(s.voiceAudio.name || '') } : null;
          })(),
        };
      }).filter((s) => (s.items ? s.items.some((it) => it.content.trim()) : s.content.trim()) || s.voiceAudio);
      if (!cleanSegments.length) { send(res, 400, { error: 'Các đoạn đều trống nội dung.' }); return; }
      const id = randomUUID().slice(0, 8);
      const jobDir = join(JOBS, id);
      mkdirSync(jobDir, { recursive: true });
      const project = {
        segments: cleanSegments,
        settings: {
          watermark: String(settings.watermark || '').slice(0, 60),
          watermarkPosition: ['top', 'bottom', 'both'].includes(settings.watermarkPosition) ? settings.watermarkPosition : 'top',
          voice: String(settings.voice || 'vi-VN-HoaiMyNeural'),
          ratePercent: Math.max(-50, Math.min(100, parseInt(settings.ratePercent ?? 20, 10) || 20)),
          cardStyle: ['embed', 'hand'].includes(settings.cardStyle) ? settings.cardStyle : 'replica',
          pauseSeconds: Math.max(0, Math.min(2, parseFloat(settings.pauseSeconds ?? 0.6) || 0.6)),
          bgmVolume: Math.max(0, Math.min(0.5, parseFloat(settings.bgmVolume ?? 0.12) || 0.12)),
          bgVideo: resolveUpload(settings.bgVideoId),
          bgImage: resolveUpload(settings.bgImageId),
          bgm: resolveUpload(settings.bgmId),
        },
      };
      const projectPath = join(jobDir, 'project.json');
      const outPath = join(OUT, `threads-comments-${id}.mp4`);
      writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');
      const job = { id, status: 'running', progress: 'Đang dựng video…', videoUrl: null, error: null, createdAt: new Date().toISOString() };
      jobs.set(id, job);
      const logPath = join(jobDir, 'render.log');
      // Ghi chú chụp/dựng thẻ (nếu lỗi) — giữ trong biến để không bị
      // render.log của render.py ghi đè mất (nó writeFileSync lại file).
      let shotNotes = '';
      for (const name of voiceMissing) shotNotes += 'Âm thanh tự chèn: không tìm thấy file "' + name + '" — đoạn đó dùng giọng AI thay thế.\n';
      // Thẻ replica: dựng lại giống giao diện Threads bản tối cho từng
      // đoạn TRƯỚC khi render.py chạy. Dựng lỗi thì đoạn đó tự rơi về
      // thẻ vẽ tay trong render.py (ghi chú vào render.log).
      if (project.settings.cardStyle === 'replica') {
        const cardDir = join(jobDir, 'cards');
        mkdirSync(cardDir, { recursive: true });
        const manifest = cleanSegments.map((s, i) => ({
          id: 'card-' + i,
          items: (s.items || [s]).map((it) => ({
            author: it.author, content: it.content, timeLabel: it.timeLabel,
            stats: it.stats, depth: it.depth || 0,
          })),
        }));
        const manifestPath = join(jobDir, 'card-manifest.json');
        writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
        try {
          const shotJson = await new Promise((resolveShot, rejectShot) => {
            const child = spawn(process.execPath, [join(ROOT, 'card-shot.js'), '--manifest', manifestPath, '--out-dir', cardDir], { timeout: 300000 });
            let out = '', err = '';
            child.stdout.on('data', (d) => { out += d; });
            child.stderr.on('data', (d) => { err += d; });
            child.on('error', rejectShot);
            child.on('close', (code) => {
              if (code !== 0) rejectShot(new Error(err.trim().split('\n').pop() || 'card-shot thất bại.'));
              else resolveShot(out);
            });
          });
          const results = JSON.parse(shotJson);
          results.forEach((r, i) => {
            if (r.ok) cleanSegments[i].cardPng = r.out;
            else shotNotes += 'Thẻ replica: bỏ qua đoạn ' + (i + 1) + ' — ' + (r.error || 'không dựng được') + '\n';
          });
          writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');
        } catch (e) {
          shotNotes += 'Thẻ replica: dựng thẻ thất bại, dùng thẻ vẽ tay — ' + (e?.message || e) + '\n';
        }
      }
      // Thẻ embed: chụp thẻ Threads chính thức cho từng URL riêng biệt
      // TRƯỚC khi render.py chạy. Chụp lỗi (thiếu playwright, embed.js
      // không render) thì đoạn đó tự rơi về thẻ vẽ tay trong render.py.
      if (project.settings.cardStyle === 'embed') {
        const urlToShot = new Map();
        for (const s of cleanSegments) {
          for (const it of (s.items || [s])) {
            const u = String(it.url || '');
            if (/^https?:\/\//.test(u) && u.includes('/post/') && !urlToShot.has(u)) {
              urlToShot.set(u, 'shot-' + urlToShot.size);
            }
          }
        }
        if (urlToShot.size) {
          const embedDir = join(jobDir, 'embed');
          mkdirSync(embedDir, { recursive: true });
          const manifestPath = join(jobDir, 'embed-manifest.json');
          writeFileSync(manifestPath, JSON.stringify([...urlToShot].map(([url, shotId]) => ({ id: shotId, url }))), 'utf8');
          try {
            const shotJson = await new Promise((resolveShot, rejectShot) => {
              const child = spawn(process.execPath, [join(ROOT, 'embed-shot.js'), '--manifest', manifestPath, '--out-dir', embedDir], { timeout: 300000 });
              let out = '', err = '';
              child.stdout.on('data', (d) => { out += d; });
              child.stderr.on('data', (d) => { err += d; });
              child.on('error', rejectShot);
              child.on('close', (code) => {
                if (code !== 0) rejectShot(new Error(err.trim().split('\n').pop() || 'embed-shot thất bại.'));
                else resolveShot(out);
              });
            });
            const results = JSON.parse(shotJson);
            const pngByUrl = new Map();
            for (const r of results) {
              if (r.ok) {
                const u = [...urlToShot].find(([, shotId]) => shotId === r.id)?.[0];
                if (u) pngByUrl.set(u, r.out);
              } else {
                shotNotes += 'Embed: bỏ qua ' + (r.id || '?') + ' — ' + (r.error || 'không chụp được') + '\n';
              }
            }
            if (pngByUrl.size) {
              for (const s of cleanSegments) {
                for (const it of (s.items || [s])) {
                  const png = pngByUrl.get(String(it.url || ''));
                  if (png) it.embedPng = png;
                }
              }
              writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');
            }
          } catch (e) {
            shotNotes += 'Embed: chụp thẻ thất bại, dùng thẻ vẽ tay — ' + (e?.message || e) + '\n';
          }
        }
      }
      // Đoạn có mã embed dán sẵn: chụp thẻ embed chính thức của đúng URL
      // đó, dùng thay thẻ thường BẤT KỂ kiểu thẻ đang chọn (ghi đè cả
      // cardPng của bước replica). Chụp lỗi thì đoạn đó giữ thẻ thường,
      // ghi chú vào render.log — không làm hỏng cả job.
      const embedSegs = cleanSegments.map((s, i) => ({ s, i })).filter(({ s }) => s.embedUrl);
      if (embedSegs.length) {
        const embedCodeDir = join(jobDir, 'embed-code');
        mkdirSync(embedCodeDir, { recursive: true });
        const embedCodeManifest = join(jobDir, 'embed-code-manifest.json');
        writeFileSync(embedCodeManifest, JSON.stringify(embedSegs.map(({ s, i }) => ({ id: 'embed-' + i, url: s.embedUrl }))), 'utf8');
        try {
          const shotJson = await new Promise((resolveShot, rejectShot) => {
            const child = spawn(process.execPath, [join(ROOT, 'embed-shot.js'), '--manifest', embedCodeManifest, '--out-dir', embedCodeDir], { timeout: 300000 });
            let out = '', err = '';
            child.stdout.on('data', (d) => { out += d; });
            child.stderr.on('data', (d) => { err += d; });
            child.on('error', rejectShot);
            child.on('close', (code) => {
              if (code !== 0) rejectShot(new Error(err.trim().split('\n').pop() || 'embed-shot thất bại.'));
              else resolveShot(out);
            });
          });
          for (const r of JSON.parse(shotJson)) {
            const idx = Number(String(r.id || '').replace('embed-', ''));
            if (r.ok) { cleanSegments[idx].cardPng = r.out; cleanSegments[idx].embedCard = true; }
            else shotNotes += 'Embed dán sẵn: bỏ qua đoạn ' + (idx + 1) + ' — ' + (r.error || 'không chụp được') + '\n';
          }
          writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');
        } catch (e) {
          shotNotes += 'Embed dán sẵn: chụp thẻ thất bại, dùng thẻ thường — ' + (e?.message || e) + '\n';
        }
      }
      // Chạy render.py bằng python của .venv nếu có (nơi đã cài Pillow
      // + edge-tts theo README) — python hệ thống thường thiếu edge-tts
      // nên giọng đọc rơi về im lặng ("No module named 'edge_tts'").
      const venvPy = join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      const PYTHON = existsSync(venvPy) ? venvPy : (process.platform === 'win32' ? 'python' : 'python3');
      // Ép Python con dùng UTF-8: Windows mặc định cp1252, log/render có
      // tiếng Việt sẽ crash UnicodeEncodeError 'charmap' (chữ ễ...).
      const child = spawn(PYTHON, [join(ROOT, 'render.py'), '--project', projectPath, '--out', outPath, '--workdir', join(jobDir, 'work')], { cwd: ROOT, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8:replace' } });
      let log = shotNotes;
      if (log) writeFileSync(logPath, log);
      child.stdout.on('data', (d) => { log += d; writeFileSync(logPath, log); job.progress = d.toString().trim().split('\n').pop(); });
      child.stderr.on('data', (d) => { log += d; writeFileSync(logPath, log); });
      child.on('close', (code) => {
        if (code === 0 && existsSync(outPath)) {
          job.status = 'done'; job.videoUrl = `/out/${basename(outPath)}`; job.progress = 'Xong.';
          // Giọng đọc rơi về im lặng ở đoạn nào thì báo thẳng trong
          // trạng thái job để người dùng không tưởng video có tiếng.
          if (log.includes('dùng im lặng')) {
            job.ttsWarning = 'Video có đoạn IM LẶNG vì giọng đọc không tạo được ở đoạn đó — bấm “Tải nhật ký render” bên dưới để xem lý do thật, hoặc bấm “Thử giọng đọc” để kiểm tra lại giọng trên máy này.';
          }
        } else {
          job.status = 'error'; job.error = 'Dựng video thất bại. Xem render.log trong thư mục jobs/' + id + '. Lỗi cuối: ' + log.trim().split('\n').slice(-3).join(' ');
        }
        writeFileSync(join(jobDir, 'status.json'), JSON.stringify(job, null, 2));
      });
      send(res, 200, { id, status: 'running' });
      return;
    }
    send(res, 404, { error: 'Không tìm thấy đường dẫn.' });
  } catch (e) {
    send(res, 500, { error: e.message || 'Lỗi server.' });
  }
});

const PORT = parseInt(process.env.PORT || '3100', 10);
server.listen(PORT, () => {
  console.log(`Threads Comment Studio chạy ở http://localhost:${PORT}`);
  // Hâm nóng Chromium nền để lần chụp thẻ thật đầu tiên khỏi chờ mở
  // trình duyệt; hâm lỗi (chưa cài playwright) thì bỏ qua, lần chụp
  // đầu sẽ báo rõ lý do.
  getCardBrowser().catch(() => {});
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { cardBrowser?.close().catch(() => {}); } catch { /* bỏ qua */ } process.exit(0); });
}
