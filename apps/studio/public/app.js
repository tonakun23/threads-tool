const $ = (s) => document.querySelector(s);
const state = { segments: [], memes: [], uploads: {}, previewUploads: {} };
const preview = { index: 0, playing: false, timer: null, lastBgKey: '', lastMemeKey: '' };
let segCounter = 0;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function status(el, msg) { el.textContent = msg || ''; }
function avatarColor(username) {
  const palette = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0284c7'];
  let h = 0; for (const ch of String(username || '?')) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return palette[h % palette.length];
}
function visibleSegments() { return state.segments.filter((s) => s.include && s.content.trim()); }
function estimateDuration(text, ratePercent) {
  const speed = 12 * (100 + ratePercent) / 100;
  return Math.max(1.5, Math.min(30, String(text || '').length / Math.max(speed, 1) + 0.4)) + 0.6;
}
function uploadUrl(u) { return u ? `/uploads/${u.id}-${u.name}` : ''; }

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

function renderPreview() {
  const segs = visibleSegments();
  const frame = $('#previewFrame');
  if (!frame) return;
  if (preview.index >= segs.length) preview.index = Math.max(0, segs.length - 1);
  // Nền: chỉ dựng lại khi nguồn nền đổi, để video nền không bị chạy lại mỗi lần gõ chữ.
  const bgKey = state.previewUploads.bgVideo || state.previewUploads.bgImage || 'gradient';
  if (bgKey !== preview.lastBgKey) {
    preview.lastBgKey = bgKey;
    const bg = $('#previewBg');
    if (state.previewUploads.bgVideo) bg.innerHTML = `<video src="${esc(state.previewUploads.bgVideo)}" muted loop autoplay playsinline></video>`;
    else if (state.previewUploads.bgImage) bg.innerHTML = `<img src="${esc(state.previewUploads.bgImage)}" alt="">`;
    else bg.innerHTML = '';
  }
  // Watermark theo đúng ô cấu hình, vị trí theo đúng select.
  const wm = $('#watermark').value.trim();
  const pos = $('#watermarkPosition').value;
  const top = $('#previewWmTop'), bottom = $('#previewWmBottom');
  top.textContent = wm; bottom.textContent = wm;
  top.hidden = !(wm && (pos === 'top' || pos === 'both'));
  bottom.hidden = !(wm && (pos === 'bottom' || pos === 'both'));
  const seg = segs[preview.index];
  const select = $('#previewSegSelect');
  select.innerHTML = segs.map((s, i) => `<option value="${i}" ${i === preview.index ? 'selected' : ''}>${i + 1}. ${s.kind === 'post' ? 'Bài gốc' : 'Bình luận'} @${esc(s.author.username)}</option>`).join('');
  if (!seg) {
    $('#previewAvatar').textContent = '?';
    $('#previewName').textContent = 'Chưa có đoạn nào';
    $('#previewTime').textContent = '';
    $('#previewContent').textContent = 'Cào link hoặc bấm “Dùng dữ liệu demo” để xem thẻ bình luận hiện lên đúng như trong video xuất ra.';
    $('#previewStats').textContent = '';
    $('#previewTts').value = '';
    $('#previewBadge').textContent = '0 / 0';
    $('#previewInfo').textContent = 'Chưa có đoạn nào được đưa vào video.';
    $('#previewMeme').hidden = true;
    return;
  }
  $('#previewAvatar').textContent = (seg.author.displayName || seg.author.username || '?').slice(0, 1).toUpperCase();
  $('#previewAvatar').style.background = avatarColor(seg.author.username);
  $('#previewName').textContent = seg.author.displayName || seg.author.username;
  $('#previewTime').textContent = seg.timeLabel || '';
  $('#previewContent').textContent = seg.content;
  $('#previewStats').textContent = `Thích ${seg.stats.likes}   •   Bình luận ${seg.stats.replies}   •   Chia sẻ ${seg.stats.reposts + seg.stats.shares}`;
  $('#previewTts').value = seg.ttsText || seg.content;
  $('#previewBadge').textContent = `${preview.index + 1} / ${segs.length} · ${seg.kind === 'post' ? 'BÀI GỐC' : 'COMMENT'}`;
  const rate = parseInt($('#rate').value, 10) || 0;
  const durs = segs.map((s) => estimateDuration(s.ttsText || s.content, rate));
  const total = durs.reduce((a, b) => a + b, 0);
  $('#previewInfo').textContent = `Đoạn này khoảng ${durs[preview.index].toFixed(1)} giây (ước lượng theo giọng đọc). Cả video khoảng ${total.toFixed(1)} giây, chưa tính thời gian render thật.`;
  // Meme của đoạn đang xem.
  const meme = seg.memeId ? state.memes.find((m) => m.id === seg.memeId) : null;
  const memeKey = meme ? meme.id : '';
  if (memeKey !== preview.lastMemeKey) {
    preview.lastMemeKey = memeKey;
    const box = $('#previewMeme');
    if (!meme) { box.hidden = true; box.innerHTML = ''; }
    else {
      const url = uploadUrl(meme);
      box.hidden = false;
      box.innerHTML = meme.kind === 'video' ? `<video src="${esc(url)}" muted loop autoplay playsinline></video>` : `<img src="${esc(url)}" alt="${esc(meme.name)}">`;
    }
  }
  // Tô viền đoạn đang xem trong danh sách kịch bản.
  document.querySelectorAll('#segments .segment').forEach((el, i) => {
    el.classList.toggle('active', state.segments[i] === seg);
  });
}
function setPreviewIndex(i) {
  const segs = visibleSegments();
  if (!segs.length) return;
  preview.index = Math.max(0, Math.min(segs.length - 1, i));
  renderPreview();
}
function stopPreviewPlay() {
  preview.playing = false;
  if (preview.timer) { clearTimeout(preview.timer); preview.timer = null; }
  const b = $('#btnPlayPreview'); if (b) b.textContent = '▶ Phát thử';
}
function playPreviewStep() {
  const segs = visibleSegments();
  if (!segs.length) { stopPreviewPlay(); return; }
  if (preview.index >= segs.length - 1) { stopPreviewPlay(); return; }
  const seg = segs[preview.index];
  const rate = parseInt($('#rate').value, 10) || 0;
  preview.timer = setTimeout(() => { preview.index += 1; renderPreview(); playPreviewStep(); }, estimateDuration(seg.ttsText || seg.content, rate) * 1000);
}
function togglePreviewPlay() {
  if (preview.playing) { stopPreviewPlay(); return; }
  const segs = visibleSegments();
  if (!segs.length) return;
  if (preview.index >= segs.length - 1) preview.index = 0;
  preview.playing = true;
  $('#btnPlayPreview').textContent = '⏸ Dừng';
  renderPreview();
  playPreviewStep();
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
        <button type="button" class="seg-view">👁 Xem</button>
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
    div.querySelector('.seg-content').addEventListener('input', (e) => { seg.content = e.target.value; renderPreview(); });
    div.querySelector('.seg-tts').addEventListener('input', (e) => { seg.ttsText = e.target.value; renderPreview(); });
    div.querySelector('.seg-include').addEventListener('change', (e) => { seg.include = e.target.checked; renderPreview(); });
    div.querySelector('.seg-meme').addEventListener('change', (e) => { seg.memeId = e.target.value; renderPreview(); });
    div.querySelector('.seg-view').addEventListener('click', () => { const vis = visibleSegments(); const idx = vis.indexOf(seg); if (idx >= 0) setPreviewIndex(idx); document.querySelector('.preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    div.querySelector('.seg-del').addEventListener('click', () => { state.segments = state.segments.filter((s) => s !== seg); renderSegments(); });
    div.querySelector('.seg-up').addEventListener('click', () => { const j = state.segments.indexOf(seg); if (j > 0) { [state.segments[j - 1], state.segments[j]] = [state.segments[j], state.segments[j - 1]]; renderSegments(); } });
    div.querySelector('.seg-down').addEventListener('click', () => { const j = state.segments.indexOf(seg); if (j < state.segments.length - 1) { [state.segments[j + 1], state.segments[j]] = [state.segments[j], state.segments[j + 1]]; renderSegments(); } });
    box.appendChild(div);
  });
  if (!state.segments.length) box.innerHTML = '<p class="hint">Chưa có đoạn nào. Cào link, dùng demo, hoặc bấm “+ Thêm Comment”.</p>';
  renderPreview();
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

$('#btnPrevSeg').addEventListener('click', () => { stopPreviewPlay(); setPreviewIndex(preview.index - 1); });
$('#btnNextSeg').addEventListener('click', () => { stopPreviewPlay(); setPreviewIndex(preview.index + 1); });
$('#btnPlayPreview').addEventListener('click', togglePreviewPlay);
$('#previewSegSelect').addEventListener('change', (e) => { stopPreviewPlay(); setPreviewIndex(parseInt(e.target.value, 10) || 0); });
$('#watermark').addEventListener('input', renderPreview);
$('#watermarkPosition').addEventListener('change', renderPreview);
$('#voice').addEventListener('change', renderPreview);

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
    try {
      const j = await uploadFile(f);
      state.uploads[key] = j.id;
      if (key === 'bgVideo' || key === 'bgImage') { state.previewUploads[key] = uploadUrl(j); preview.lastBgKey = ''; }
      $(statusId).textContent = 'Đã tải lên: ' + j.name;
      renderPreview();
    }
    catch (err) { $(statusId).textContent = 'Lỗi: ' + err.message; }
  });
}
bindUpload('#bgVideoFile', '#bgVideoStatus', 'bgVideo');
bindUpload('#bgImageFile', '#bgImageStatus', 'bgImage');
bindUpload('#bgmFile', '#bgmStatus', 'bgm');

$('#rate').addEventListener('input', (e) => { $('#rateLabel').textContent = (e.target.value >= 0 ? '+' : '') + e.target.value + '%'; renderPreview(); });
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
        $('#renderedVideo').src = job.videoUrl; $('#renderedVideo').hidden = false;
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
