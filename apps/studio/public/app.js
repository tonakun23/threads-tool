const $ = (s) => document.querySelector(s);
const state = { segments: [], memes: [], uploads: {} };
let segCounter = 0;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function status(el, msg) { el.textContent = msg || ''; }

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Upload thất bại.');
  return j;
}

function makeSegment(author, content, stats, timeLabel, kind) {
  return { key: ++segCounter, kind, author: { username: author?.username || 'unknown', displayName: author?.displayName || author?.username || 'unknown', isVerified: !!author?.isVerified }, content: content || '', ttsText: content || '', timeLabel: timeLabel || '', stats: stats || { likes: 0, replies: 0, reposts: 0, shares: 0 }, memeId: '', include: true };
}

function renderSegments() {
  const box = $('#segments');
  box.innerHTML = '';
  state.segments.forEach((seg, i) => {
    const div = document.createElement('div');
    div.className = 'segment';
    const label = seg.kind === 'post' ? 'BÀI GỐC' : `COMMENT #${i}`;
    div.innerHTML = `
      <div class="seg-head">
        <span class="badge">${label}</span>
        <strong>@${esc(seg.author.username)}</strong><span>${esc(seg.author.displayName)}</span>
        <span>${esc(seg.timeLabel)}</span>
        <label><input type="checkbox" class="seg-include" ${seg.include ? 'checked' : ''}> Đưa vào video</label>
        <button type="button" class="seg-up">↑</button><button type="button" class="seg-down">↓</button>
        <button type="button" class="seg-del">Xoá</button>
      </div>
      <div class="cols">
        <label>1. Chữ hiển thị trên thẻ (giữ viết tắt):
          <textarea class="seg-content">${esc(seg.content)}</textarea></label>
        <label>2. Chữ đọc lồng tiếng TTS (đã dịch):
          <textarea class="seg-tts">${esc(seg.ttsText)}</textarea></label>
      </div>
      <label>Meme chèn trong đoạn này:
        <select class="seg-meme"><option value="">— Không chèn meme —</option>${state.memes.map((m) => `<option value="${m.id}" ${seg.memeId === m.id ? 'selected' : ''}>${esc(m.name)} (${m.kind})</option>`).join('')}</select>
      </label>
      <p class="hint">♥ ${seg.stats.likes} · 💬 ${seg.stats.replies} · 🔁 ${seg.stats.reposts} · ↗ ${seg.stats.shares}</p>`;
    div.querySelector('.seg-content').addEventListener('input', (e) => { seg.content = e.target.value; });
    div.querySelector('.seg-tts').addEventListener('input', (e) => { seg.ttsText = e.target.value; });
    div.querySelector('.seg-include').addEventListener('change', (e) => { seg.include = e.target.checked; });
    div.querySelector('.seg-meme').addEventListener('change', (e) => { seg.memeId = e.target.value; });
    div.querySelector('.seg-del').addEventListener('click', () => { state.segments = state.segments.filter((s) => s !== seg); renderSegments(); });
    div.querySelector('.seg-up').addEventListener('click', () => { const j = state.segments.indexOf(seg); if (j > 0) { [state.segments[j - 1], state.segments[j]] = [state.segments[j], state.segments[j - 1]]; renderSegments(); } });
    div.querySelector('.seg-down').addEventListener('click', () => { const j = state.segments.indexOf(seg); if (j < state.segments.length - 1) { [state.segments[j + 1], state.segments[j]] = [state.segments[j], state.segments[j + 1]]; renderSegments(); } });
    box.appendChild(div);
  });
  if (!state.segments.length) box.innerHTML = '<p class="hint">Chưa có đoạn nào. Cào link, dùng demo, hoặc bấm “+ Thêm Comment”.</p>';
}

function loadData(data) {
  state.segments = [];
  if (data.post) state.segments.push(makeSegment(data.post.author, data.post.content, data.post.stats, data.post.timestamp, 'post'));
  (data.comments || []).forEach((c) => state.segments.push(makeSegment(c.author, c.content, c.stats, c.timestamp, 'comment')));
  renderSegments();
  status($('#scrapeStatus'), `Đã có bài viết gốc của @${data.post?.author?.username || '?'} và ${data.comments?.length || 0} bình luận (${data.source || 'live'}). Kiểm tra và sửa kịch bản ở mục 2 rồi xuất video.`);
}

async function doScrape(mode, extra) {
  const btn = $('#btnScrape'); btn.disabled = true;
  status($('#scrapeStatus'), 'Đang cào… (Threads có thể chậm, chờ 10–60 giây)');
  try {
    const r = await fetch('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, url: $('#postUrl').value, maxComments: $('#maxComments').value, ...extra }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Cào thất bại.');
    loadData(j);
  } catch (e) { status($('#scrapeStatus'), 'Lỗi: ' + e.message + ' — Thử “Dùng dữ liệu demo” để test luồng render.'); }
  finally { btn.disabled = false; }
}

$('#btnScrape').addEventListener('click', () => doScrape('live'));
$('#btnDemo').addEventListener('click', () => doScrape('demo'));
$('#btnPasteToggle').addEventListener('click', () => { $('#pasteBox').hidden = !$('#pasteBox').hidden; });
$('#btnPaste').addEventListener('click', () => doScrape('paste', { pasteJson: $('#pasteJson').value }));
$('#btnAddComment').addEventListener('click', () => { state.segments.push(makeSegment({ username: 'nguoi_dung', displayName: 'Người dùng' }, '', { likes: 0, replies: 0, reposts: 0, shares: 0 }, '', 'comment')); renderSegments(); });

$('#btnMemeUpload').addEventListener('click', async () => {
  const f = $('#memeFile').files[0];
  if (!f) { alert('Chọn file meme (ảnh/video) trước.'); return; }
  try {
    const j = await uploadFile(f);
    state.memes.push(j);
    $('#memeLibrary').innerHTML = state.memes.map((m) => `<li>${esc(m.name)} · ${m.kind}</li>`).join('');
    renderSegments();
  } catch (e) { alert(e.message); }
});

async function bindUpload(inputId, statusId, key) {
  $(inputId).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = await uploadFile(f); state.uploads[key] = j.id; $(statusId).textContent = 'Đã tải lên: ' + j.name; }
    catch (err) { $(statusId).textContent = 'Lỗi: ' + err.message; }
  });
}
bindUpload('#bgVideoFile', '#bgVideoStatus', 'bgVideo');
bindUpload('#bgImageFile', '#bgImageStatus', 'bgImage');
bindUpload('#bgmFile', '#bgmStatus', 'bgm');

$('#rate').addEventListener('input', (e) => { $('#rateLabel').textContent = (e.target.value >= 0 ? '+' : '') + e.target.value + '%'; });
$('#bgmVolume').addEventListener('input', (e) => { $('#bgmLabel').textContent = e.target.value + '%'; });

$('#btnRender').addEventListener('click', async () => {
  const segments = state.segments.filter((s) => s.include && s.content.trim()).map((s) => ({
    author: s.author, content: s.content, ttsText: s.ttsText || s.content,
    timeLabel: s.timeLabel, stats: s.stats,
    meme: s.memeId ? (() => { const m = state.memes.find((x) => x.id === s.memeId); return m ? { id: m.id, kind: m.kind, name: m.name } : null; })() : null,
  }));
  if (!segments.length) { status($('#renderStatus'), 'Chưa có đoạn nào để xuất. Cào link hoặc thêm comment trước.'); return; }
  const btn = $('#btnRender'); btn.disabled = true;
  status($('#renderStatus'), 'Đang gửi yêu cầu dựng video…');
  try {
    const r = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      segments,
      settings: {
        watermark: $('#watermark').value, watermarkPosition: $('#watermarkPosition').value,
        voice: $('#voice').value, ratePercent: parseInt($('#rate').value, 10),
        bgmVolume: parseInt($('#bgmVolume').value, 10) / 100,
        bgVideoId: state.uploads.bgVideo || null, bgImageId: state.uploads.bgImage || null, bgmId: state.uploads.bgm || null,
      },
    }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Không tạo được job render.');
    const poll = setInterval(async () => {
      const jr = await fetch('/api/jobs/' + j.id); const job = await jr.json();
      status($('#renderStatus'), (job.progress || job.status) + (job.status === 'running' ? ' ⏳' : ''));
      if (job.status === 'done') {
        clearInterval(poll); btn.disabled = false;
        $('#preview').src = job.videoUrl; $('#preview').hidden = false;
        const dl = $('#downloadLink'); dl.href = job.videoUrl; dl.hidden = false; dl.setAttribute('download', '');
        status($('#renderStatus'), 'Xong! Xem trước ở trên, bấm “Tải video xuống” để lấy file MP4.');
      } else if (job.status === 'error') {
        clearInterval(poll); btn.disabled = false;
        status($('#renderStatus'), 'Lỗi: ' + (job.error || 'Không rõ.'));
      }
    }, 3000);
  } catch (e) { btn.disabled = false; status($('#renderStatus'), 'Lỗi: ' + e.message); }
});

renderSegments();
