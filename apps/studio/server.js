/**
 * Studio server — chỉ dùng module có sẵn của Node, không cần npm install
 * để chạy UI + render (render cần Python + Pillow + FFmpeg hệ thống).
 * Cào live cần thêm: npm install playwright && npx playwright install chromium
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE);
const UPLOADS = join(ROOT, 'uploads');
const OUT = join(ROOT, 'out');
const JOBS = join(ROOT, 'jobs');
for (const d of [UPLOADS, OUT, JOBS]) mkdirSync(d, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const VOICES = [
  { id: 'vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ — Chuẩn)', gender: 'Nữ' },
  { id: 'vi-VN-NamMinhNeural', label: 'Nam Minh (Nam — Chuẩn)', gender: 'Nam' },
  { id: 'vi-VN-HoaiMyNeural', label: 'Hoài My (Nữ — Trẻ)', gender: 'Nữ' },
];
const jobs = new Map();

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
    stats: { likes: p.stats?.likes || 0, replies: p.stats?.replies || 0, reposts: p.stats?.reposts || 0, shares: p.stats?.shares || 0 },
  }));
  if (!posts.length) throw new Error('Không có bài nào hợp lệ trong JSON đã dán.');
  const main = posts.find((p) => !p.source) || posts[0];
  const comments = posts.filter((p) => p.id !== main.id).sort((a, b) => (b.stats.likes + b.stats.replies * 3) - (a.stats.likes + a.stats.replies * 3));
  return { post: main, comments };
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
    if (req.method === 'GET' && p.startsWith('/api/jobs/')) {
      const id = basename(p);
      const job = jobs.get(id);
      if (job) { send(res, 200, job); return; }
      const f = join(JOBS, id, 'status.json');
      if (existsSync(f)) { send(res, 200, JSON.parse(readFileSync(f, 'utf8'))); return; }
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
        demo.comments = demo.comments.slice(0, maxComments);
        send(res, 200, demo); return;
      }
      if (mode === 'paste') {
        let raw;
        try { raw = JSON.parse(body.pasteJson || ''); } catch { send(res, 400, { error: 'JSON dán vào không hợp lệ.' }); return; }
        const norm = normalizeDataset(raw);
        norm.comments = norm.comments.slice(0, maxComments);
        norm.source = 'paste';
        send(res, 200, norm); return;
      }
      const url = String(body.url || '').trim();
      if (!url || !/threads\.(com|net)/i.test(url)) { send(res, 400, { error: 'Dán link bài viết Threads (threads.com / threads.net).' }); return; }
      const child = spawn(process.execPath, [join(ROOT, 'scraper.js'), url, String(maxComments)], { timeout: 150000 });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => {
        if (code !== 0) { send(res, 502, { error: (err.trim().split('\n').pop() || 'Cào live thất bại. Thử chế độ Demo hoặc dán JSON dataset của toolkit.') }); return; }
        try { const data = JSON.parse(out); data.comments = data.comments.slice(0, maxComments); send(res, 200, data); }
        catch { send(res, 502, { error: 'Scraper trả về dữ liệu không đọc được.' }); }
      });
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
      const cleanSegments = segments.map((s) => ({
        author: { username: String(s.author?.username || 'unknown').slice(0, 40), displayName: String(s.author?.displayName || s.author?.username || 'unknown').slice(0, 60), isVerified: !!s.author?.isVerified },
        content: String(s.content || '').slice(0, 2000),
        ttsText: String(s.ttsText || s.content || '').slice(0, 2000),
        timeLabel: String(s.timeLabel || s.timestamp || '').slice(0, 20),
        stats: { likes: Number(s.stats?.likes || 0), replies: Number(s.stats?.replies || 0), reposts: Number(s.stats?.reposts || 0), shares: Number(s.stats?.shares || 0) },
        meme: s.meme?.id ? { kind: s.meme.kind || 'image', path: resolveUpload(s.meme.id), name: s.meme.name || '' } : null,
      })).filter((s) => s.content.trim());
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
      const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
      const child = spawn(PYTHON, [join(ROOT, 'render.py'), '--project', projectPath, '--out', outPath, '--workdir', join(jobDir, 'work')], { cwd: ROOT });
      let log = '';
      child.stdout.on('data', (d) => { log += d; writeFileSync(logPath, log); job.progress = d.toString().trim().split('\n').pop(); });
      child.stderr.on('data', (d) => { log += d; writeFileSync(logPath, log); });
      child.on('close', (code) => {
        if (code === 0 && existsSync(outPath)) {
          job.status = 'done'; job.videoUrl = `/out/${basename(outPath)}`; job.progress = 'Xong.';
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
server.listen(PORT, () => console.log(`Threads Comment Studio chạy ở http://localhost:${PORT}`));
