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
function visibleSegments() { return state.segments.filter((s) => s.include && segItems(s).some((it) => (it.content || '').trim())); }
function estimateDuration(text, ratePercent) {
  const speed = 12 * (100 + ratePercent) / 100;
  return Math.max(1.5, Math.min(30, String(text || '').length / Math.max(speed, 1) + 0.4)) + 0.6;
}
function uploadUrl(u) { return u ? `/uploads/${u.id}-${u.name}` : ''; }
function formatCompact(n) {
  const v = Number(n) || 0;
  const f1 = (x) => { const s = (Math.round(x * 10) / 10).toString().replace('.', ','); return s.endsWith(',0') ? s.slice(0, -2) : s; };
  if (v >= 1000000) return f1(v / 1000000) + 'M';
  if (v >= 1000) return f1(v / 1000) + 'K';
  return String(v);
}
function formatTimeLabel(ts, timeLabel) {
  if (timeLabel) return timeLabel;
  const raw = String(ts || '').trim();
  if (!raw || raw.includes('T')) {
    const t = Date.parse(raw);
    if (isNaN(t)) return '';
    const diff = Math.max(0, Date.now() - t);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Vừa xong';
    if (min < 60) return min + ' phút';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' giờ';
    const d = Math.floor(h / 24);
    if (d < 7) return d + ' ngày';
    if (d < 30) return Math.floor(d / 7) + ' tuần';
    const dt = new Date(t);
    return dt.getDate() + '/' + (dt.getMonth() + 1) + '/' + dt.getFullYear();
  }
  return raw;
}
function avatarLetter(username) {
  const m = String(username || '').match(/[A-Za-z0-9À-ỹ]/);
  return (m ? m[0] : '?').toUpperCase();
}
function statsLine(stats) {
  const s = stats || {};
  return `♥ ${formatCompact(s.likes)}   💬 ${formatCompact(s.replies)}   🔁 ${formatCompact(s.reposts)}   ↗ ${formatCompact(s.shares)}`;
}
function segItems(seg) {
  if (seg.kind === 'chain') return seg.items;
  return [{ author: seg.author, content: seg.content, ttsText: seg.ttsText, timeLabel: seg.timeLabel, timestamp: seg.timestamp, stats: seg.stats, url: seg.url || '' }];
}
function segText(seg) { return segItems(seg).map((it) => it.ttsText || it.content).join(' '); }

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Upload thất bại.');
  return j;
}

function makeSegment(author, content, stats, timeLabel, kind, timestamp, url) {
  return { key: ++segCounter, kind, author: { username: author?.username || 'unknown', displayName: author?.displayName || author?.username || 'unknown', isVerified: !!author?.isVerified }, content: content || '', ttsText: content || '', timeLabel: timeLabel || '', timestamp: timestamp || '', url: url || '', stats: stats || { likes: 0, replies: 0, reposts: 0, shares: 0 }, memeId: '', include: true };
}
function makeChainSegment(posts) {
  return {
    key: ++segCounter, kind: 'chain', memeId: '', include: true,
    items: posts.map((p) => ({
      author: { username: p.author?.username || 'unknown', displayName: p.author?.displayName || p.author?.username || 'unknown', isVerified: !!p.author?.isVerified },
      content: p.content || '', ttsText: p.content || '',
      timeLabel: p.timeLabel || '', timestamp: p.timestamp || '', url: p.url || '',
      stats: p.stats || { likes: 0, replies: 0, reposts: 0, shares: 0 },
      depth: Number(p.depth || 0), parentId: p.parentId || null, id: p.id || '',
    })),
  };
}
function groupCommentsIntoChains(comments) {
  // Giữ thứ tự trang; reply (parentId/depth) gộp vào chuỗi trước đó chứa cha.
  const chains = [];
  for (const c of comments) {
    if (!c.parentId || !Number(c.depth)) { chains.push([c]); continue; }
    const target = [...chains].reverse().find((ch) => ch.some((x) => x.id === c.parentId));
    if (target) target.push(c);
    else if (chains.length) chains[chains.length - 1].push(c);
    else chains.push([c]);
  }
  return chains;
}

// Thẻ embed thật đang hiện trong khung xem trước (nếu có): giữ theo
// key của đoạn, đổi đoạn thì quay về bản mô phỏng.
const embedShotView = { key: null, shots: null };

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
  // Đổi đoạn thì bỏ ảnh embed đã chụp, quay về bản mô phỏng.
  if (!seg || embedShotView.key !== seg.key) { embedShotView.key = seg ? seg.key : null; embedShotView.shots = null; }
  const select = $('#previewSegSelect');
  select.innerHTML = segs.map((s, i) => { const first = segItems(s)[0]; return `<option value="${i}" ${i === preview.index ? 'selected' : ''}>${i + 1}. ${s.kind === 'post' ? 'Bài gốc' : 'Bình luận'} @${esc(first?.author.username || '?')}${segItems(s).length > 1 ? ` +${segItems(s).length - 1} trả lời` : ''}</option>`; }).join('');
  if (!seg) {
    $('#previewEmbedShots').hidden = true; $('#previewEmbedShots').innerHTML = '';
    $('#previewCardItems').innerHTML = `<div class="preview-item"><div class="preview-card-head"><span class="preview-avatar">?</span><span class="preview-names"><strong>Chưa có đoạn nào</strong></span></div><p class="preview-content">Cào link hoặc bấm “Dùng dữ liệu demo” để xem thẻ bình luận hiện lên đúng như trong video xuất ra.</p></div>`;
    $('#previewTts').value = '';
    $('#previewBadge').textContent = '0 / 0';
    $('#previewInfo').textContent = 'Chưa có đoạn nào được đưa vào video.';
    $('#previewMeme').hidden = true;
    return;
  }
  const items = segItems(seg);
  const shotsBox = $('#previewEmbedShots');
  if (embedShotView.shots) {
    // Hiện đúng thẻ embed thật đã chụp, thay cho bản mô phỏng.
    $('#previewCardItems').innerHTML = '';
    shotsBox.hidden = false;
    shotsBox.innerHTML = embedShotView.shots.map((s) => `<img src="${esc(s.pngUrl)}" alt="Thẻ embed Threads">`).join('');
  } else {
    shotsBox.hidden = true; shotsBox.innerHTML = '';
    $('#previewCardItems').innerHTML = items.map((it, i) => `
    <div class="preview-item ${i > 0 ? 'reply' : ''}">
      <div class="preview-card-head">
        <span class="preview-avatar" style="background:${avatarColor(it.author.username)}">${esc(avatarLetter(it.author.username))}</span>
        <span class="preview-names"><strong>@${esc(it.author.username)}</strong><small>${esc(formatTimeLabel(it.timestamp, it.timeLabel))}</small></span>
      </div>
      <p class="preview-content">${esc(it.content)}</p>
      <p class="preview-stats">${esc(statsLine(it.stats))}</p>
    </div>`).join('');
  }
  $('#previewTts').value = items.map((it) => it.ttsText || it.content).join('\n');
  const kindLabel = seg.kind === 'post' ? 'BÀI GỐC' : (items.length > 1 ? `CHUỖI · ${items.length} BÌNH LUẬN` : 'BÌNH LUẬN');
  $('#previewBadge').textContent = `${preview.index + 1} / ${segs.length} · ${kindLabel}`;
  const rate = parseInt($('#rate').value, 10) || 0;
  const durs = segs.map((s) => estimateDuration(segText(s), rate));
  const total = durs.reduce((a, b) => a + b, 0);
  $('#previewInfo').textContent = `Đoạn này khoảng ${durs[preview.index].toFixed(1)} giây (ước lượng theo giọng đọc). Cả video khoảng ${total.toFixed(1)} giây, chưa tính thời gian render thật.`;
  if (embedShotView.shots) $('#previewInfo').textContent += ' Đang hiện thẻ embed thật từ Threads (nền sáng) — đúng thẻ sẽ dùng trong video khi chọn kiểu thẻ Embed.';
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
  preview.timer = setTimeout(() => { preview.index += 1; renderPreview(); playPreviewStep(); }, estimateDuration(segText(seg), rate) * 1000);
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
    const items = segItems(seg);
    const first = items[0];
    const label = seg.kind === 'post' ? 'BÀI GỐC' : (items.length > 1 ? `CHUỖI BÌNH LUẬN · ${items.length}` : `COMMENT #${i}`);
    const itemsHtml = items.map((it, j) => `
      <div class="chain-item ${j > 0 ? 'reply' : ''}">
        <p class="hint" style="margin:0 0 6px"><strong>@${esc(it.author.username)}</strong> · ${esc(formatTimeLabel(it.timestamp, it.timeLabel))} · ${esc(statsLine(it.stats))}</p>
        <div class="cols">
          <label>1. Chữ hiển thị trên thẻ (giữ viết tắt):
            <textarea class="seg-content" data-item="${j}">${esc(it.content)}</textarea></label>
          <label>2. Chữ đọc lồng tiếng TTS (đã dịch):
            <textarea class="seg-tts" data-item="${j}">${esc(it.ttsText)}</textarea></label>
        </div>
      </div>`).join('');
    div.innerHTML = `
      <div class="seg-head">
        <span class="badge">${label}</span>
        <strong>@${esc(first.author.username)}</strong><span>${esc(first.author.displayName)}</span>
        <span>${esc(formatTimeLabel(first.timestamp, first.timeLabel))}</span>
        <label><input type="checkbox" class="seg-include" ${seg.include ? 'checked' : ''}> Đưa vào video</label>
        <button type="button" class="seg-view">👁 Xem</button>
        <button type="button" class="seg-up">↑</button><button type="button" class="seg-down">↓</button>
        <button type="button" class="seg-del">Xoá</button>
      </div>
      ${itemsHtml}
      <label>Meme chèn trong đoạn này:
        <select class="seg-meme"><option value="">— Không chèn meme —</option>${state.memes.map((m) => `<option value="${m.id}" ${seg.memeId === m.id ? 'selected' : ''}>${esc(m.name)} (${m.kind})</option>`).join('')}</select>
      </label>`;
    div.querySelectorAll('.seg-content').forEach((ta) => ta.addEventListener('input', (e) => { items[Number(e.target.dataset.item)].content = e.target.value; renderPreview(); }));
    div.querySelectorAll('.seg-tts').forEach((ta) => ta.addEventListener('input', (e) => { items[Number(e.target.dataset.item)].ttsText = e.target.value; renderPreview(); }));
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
  if (data.post) state.segments.push(makeSegment(data.post.author, data.post.content, data.post.stats, data.post.timeLabel || '', 'post', data.post.timestamp, data.post.url || ''));
  const chains = groupCommentsIntoChains(data.comments || []);
  for (const ch of chains) state.segments.push(makeChainSegment(ch));
  renderSegments();
  status($('#scrapeStatus'), `Đã có bài viết gốc của @${data.post?.author?.username || '?'} và ${data.comments?.length || 0} bình luận (${data.source || 'live'}), gộp thành ${chains.length} chuỗi hội thoại theo đúng thứ tự trên Threads. Kiểm tra và sửa kịch bản ở mục 2 rồi xuất video.`);
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

async function showEmbedShots() {
  const segs = visibleSegments();
  const seg = segs[preview.index];
  if (!seg) return;
  const urls = segItems(seg).map((it) => it.url || '').filter((u) => u.includes('/post/'));
  const btn = $('#btnEmbedPreview');
  if (!urls.length) {
    $('#previewInfo').textContent = 'Đoạn này không có link Threads (thêm tay) nên không chụp thẻ embed được. Trong video, đoạn này dùng thẻ vẽ tay.';
    return;
  }
  btn.disabled = true; btn.textContent = '⏳ Đang chụp thẻ thật…';
  try {
    const r = await fetch('/api/embed-shots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Không chụp được.');
    const okShots = (j.shots || []).filter((s) => s.ok);
    if (!okShots.length) throw new Error((j.shots || [])[0]?.error || 'Không chụp được thẻ embed.');
    embedShotView.key = seg.key; embedShotView.shots = okShots;
    renderPreview();
  } catch (e) {
    $('#previewInfo').textContent = 'Không chụp được thẻ embed: ' + e.message + ' — Vẫn hiện bản mô phỏng; video xuất ra sẽ dùng thẻ vẽ tay nếu chụp lỗi.';
  } finally { btn.disabled = false; btn.textContent = '📷 Xem thẻ embed thật'; }
}
$('#btnEmbedPreview').addEventListener('click', showEmbedShots);
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
$('#btnAddComment').addEventListener('click', () => { state.segments.push(makeChainSegment([{ author: { username: 'nguoi_dung', displayName: 'Người dùng' }, content: '', stats: { likes: 0, replies: 0, reposts: 0, shares: 0 }, timestamp: '' }])); renderSegments(); });

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
  const segments = state.segments.filter((s) => s.include && segItems(s).some((it) => (it.content || '').trim())).map((s) => {
    const items = segItems(s).map((it) => ({
      author: it.author, content: it.content, ttsText: it.ttsText || it.content,
      timeLabel: formatTimeLabel(it.timestamp, it.timeLabel), stats: it.stats, depth: it.depth || 0,
      url: it.url || '',
    }));
    const first = items[0];
    return {
      kind: s.kind, author: first.author, content: first.content, ttsText: first.ttsText,
      timeLabel: first.timeLabel, stats: first.stats, url: first.url || '', items: items.length > 1 ? items : undefined,
      meme: s.memeId ? (() => { const m = state.memes.find((x) => x.id === s.memeId); return m ? { id: m.id, kind: m.kind, name: m.name } : null; })() : null,
    };
  });
  if (!segments.length) { status($('#renderStatus'), 'Chưa có đoạn nào để xuất. Cào link hoặc thêm comment trước.'); return; }
  const btn = $('#btnRender'); btn.disabled = true;
  status($('#renderStatus'), 'Đang gửi yêu cầu dựng video…');
  try {
    const r = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      segments,
      settings: {
        watermark: $('#watermark').value, watermarkPosition: $('#watermarkPosition').value,
        voice: $('#voice').value, ratePercent: parseInt($('#rate').value, 10),
        cardStyle: $('#cardStyle') ? $('#cardStyle').value : 'embed',
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
