const $ = (s) => document.querySelector(s);
const state = { segments: [], memes: [], uploads: {}, previewUploads: {} };
const preview = { index: 0, playing: false, timer: null, lastBgKey: '', lastMemeKey: '', lastTtsKey: '' };
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
function segText(seg) { return segItems(seg).map((it) => it.ttsText ?? it.content).join(' '); }
// Chữ đọc mặc định: chỉ giữ phần đáng đọc, bỏ hashtag, link,
// @nhắc tên và emoji — giọng đọc không cần đọc những thứ đó (Tony
// 31/10: đọc cả hashtag nghe thừa). Chỉ áp khi tạo đoạn từ dữ liệu
// cào/demo/dán; chữ đã sửa tay trong ô TTS thì giữ nguyên, không
// dọn lại. Trả '' khi không còn gì để đọc (vd bình luận chỉ có
// @nhắc tên) — đoạn đó sẽ im lặng thay vì đọc câu giữ chỗ.
function cleanTtsText(text) {
  let t = String(text || '');
  t = t.replace(/https?:\/\/\S+/gi, ' ');
  t = t.replace(/\bwww\.\S+/gi, ' ');
  // Tên miền trần (niemphat.online/s/...) — giữ lại số thuần như 1.5,
  // v1.2.3 và tên viết tắt kiểu U.S.A (phần cuối 1 ký tự/số).
  t = t.replace(/[\wÀ-ỹ-]+(?:\.[\wÀ-ỹ-]+)+(?:\/\S*)?/g, (tok) => {
    const domain = tok.split('/')[0];
    const last = domain.split('.').pop() || '';
    if (!/[A-Za-zÀ-ỹ]/.test(tok)) return tok;
    return /^[A-Za-zÀ-ỹ]{2,}$/.test(last) ? ' ' : tok;
  });
  t = t.replace(/#[\p{L}\p{N}_]+/gu, ' ');
  t = t.replace(/@[\p{L}\p{N}_.]+/gu, ' ');
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu, ' ');
  return t.replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Upload thất bại.');
  return j;
}

function makeSegment(author, content, stats, timeLabel, kind, timestamp, url) {
  return { key: ++segCounter, kind, author: { username: author?.username || 'unknown', displayName: author?.displayName || author?.username || 'unknown', isVerified: !!author?.isVerified, avatarUrl: author?.avatarUrl || '' }, content: content || '', ttsText: cleanTtsText(content || ''), timeLabel: timeLabel || '', timestamp: timestamp || '', url: url || '', stats: stats || { likes: 0, replies: 0, reposts: 0, shares: 0 }, memeId: '', embedCode: '', voiceAudio: null, include: true };
}
function makeChainSegment(posts) {
  return {
    key: ++segCounter, kind: 'chain', memeId: '', embedCode: '', voiceAudio: null, include: true,
    items: posts.map((p) => ({
      author: { username: p.author?.username || 'unknown', displayName: p.author?.displayName || p.author?.username || 'unknown', isVerified: !!p.author?.isVerified, avatarUrl: p.author?.avatarUrl || '' },
      content: p.content || '', ttsText: cleanTtsText(p.content || ''),
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
// Lý do lần dựng thẻ thật gần nhất thất bại (hiện trong previewInfo).
let lastShotError = null;
// Cache thẻ thật theo đoạn + nội dung, để chuyển đoạn qua lại không
// phải dựng lại, sửa chữ mới dựng lại.
const realShotCache = new Map();
let realShotSeq = 0;
let shotRefreshTimer = null;
// Đoạn đang chờ dựng thẻ thật: khung xem trước hiện dòng "Đang dựng
// thẻ thật…" thay vì chớp sang bản mô phỏng cũ rồi mới đổi lại.
const shotPending = new Set();
function markShotPending(seg) {
  if (!seg || currentCardStyle() === 'hand') return;
  const cached = realShotCache.get(seg.key);
  if (cached && cached.hash === shotHash(seg)) return;
  shotPending.add(seg.key);
}

function currentCardStyle() { return $('#cardStyle') ? $('#cardStyle').value : 'replica'; }
// Lấy link bài Threads từ mã embed đã dán (blockquote text-post-media
// lấy từ nút … → Get embed code): ưu tiên data-text-post-permalink,
// rồi tới href tới /post/ trong mã. Không phải mã embed thì trả ''.
function parseEmbedCode(code) {
  const s = String(code || '');
  const m = s.match(/data-text-post-permalink=["']([^"']+)["']/i)
    || s.match(/href=["'](https?:\/\/[^"']*\/post\/[^"']*)["']/i);
  const url = m ? m[1] : '';
  return /^https?:\/\//.test(url) && /threads\.(com|net)/i.test(url) && url.includes('/post/') ? url : '';
}
function shotHash(seg) {
  return JSON.stringify([seg.embedCode || '', segItems(seg).map((it) => [it.author?.username, it.author?.avatarUrl, it.content, it.timeLabel, it.stats, it.depth])]);
}
async function ensureRealShot(seg, opts = {}) {
  if (!seg || currentCardStyle() === 'hand') return;
  const hash = shotHash(seg);
  const cached = realShotCache.get(seg.key);
  if (!opts.force && cached && cached.hash === hash) {
    if (embedShotView.key !== seg.key || !embedShotView.shots) {
      embedShotView.key = seg.key; embedShotView.shots = cached.shots; renderPreview();
    }
    return;
  }
  const seq = ++realShotSeq;
  shotPending.add(seg.key);
  const vis0 = visibleSegments();
  if (vis0[preview.index] === seg) renderPreview();
  try {
    let shots;
    const embedUrl = parseEmbedCode(seg.embedCode || '');
    if (embedUrl) {
      // Đoạn có mã embed dán sẵn: chụp đúng thẻ embed chính thức của
      // URL đó, bất kể kiểu thẻ đang chọn.
      const r = await fetch('/api/embed-shots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: [embedUrl] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Không chụp được thẻ embed.');
      shots = (j.shots || []).filter((s) => s.ok);
      if (!shots.length) throw new Error((j.shots || [])[0]?.error || 'Không chụp được thẻ embed.');
    } else if (currentCardStyle() === 'embed') {
      const urls = segItems(seg).map((it) => it.url || '').filter((u) => u.includes('/post/'));
      if (!urls.length) {
        if (seq === realShotSeq) {
          shotPending.delete(seg.key);
          lastShotError = { segKey: seg.key, msg: 'Đoạn này không có link Threads (thêm tay) nên không chụp thẻ embed được. Trong video, đoạn này dùng thẻ vẽ tay.' };
          renderPreview();
        }
        return;
      }
      const r = await fetch('/api/embed-shots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Không chụp được.');
      shots = (j.shots || []).filter((s) => s.ok);
      if (!shots.length) throw new Error((j.shots || [])[0]?.error || 'Không chụp được thẻ embed.');
    } else {
      const items = segItems(seg).map((it) => ({
        author: it.author, content: it.content,
        timeLabel: formatTimeLabel(it.timestamp, it.timeLabel), stats: it.stats, depth: it.depth || 0,
      }));
      const r = await fetch('/api/card-shots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Không dựng được thẻ.');
      if (!j.pngUrl) throw new Error('Không dựng được thẻ.');
      shots = [{ pngUrl: j.pngUrl }];
    }
    if (seq !== realShotSeq) return; // đã có yêu cầu mới hơn
    lastShotError = null;
    shotPending.delete(seg.key);
    realShotCache.set(seg.key, { hash, shots });
    const vis = visibleSegments();
    if (vis[preview.index] === seg) { embedShotView.key = seg.key; embedShotView.shots = shots; renderPreview(); }
  } catch (e) {
    if (seq !== realShotSeq) return;
    shotPending.delete(seg.key);
    lastShotError = { segKey: seg.key, msg: e.message };
    renderPreview();
  }
}
function scheduleShotRefresh(seg) {
  if (currentCardStyle() === 'hand') return;
  clearTimeout(shotRefreshTimer);
  shotRefreshTimer = setTimeout(() => {
    const vis = visibleSegments();
    if (vis[preview.index] === seg) ensureRealShot(seg);
  }, 1200);
}

// Ô sửa chữ đọc trong khung xem trước: một ô cho mỗi bình luận của
// đoạn đang xem, đồng bộ hai chiều với mục 2. Chỉ dựng lại khi đổi
// đoạn (khỏi mất vị trí gõ); khi sửa ở mục 2 thì đồng bộ giá trị
// vào các ô không đang được gõ.
function segEstDuration(seg, rate) {
  // Đoạn dùng file âm thanh tự chèn thì dài bằng file đó, không ước
  // lượng theo chữ đọc nữa.
  const va = seg.voiceAudio;
  if (va && va.seconds) return va.seconds;
  return estimateDuration(segText(seg), rate);
}
function renderPreviewTtsBox(seg) {
  const box = $('#previewTtsBox');
  if (!box) return;
  const items = seg ? segItems(seg) : [];
  const key = seg ? seg.key + ':' + items.length + ':' + (seg.voiceAudio ? 'va' : '') : 'none';
  if (preview.lastTtsKey !== key) {
    preview.lastTtsKey = key;
    const note = seg && seg.voiceAudio ? '<p class="hint" style="margin:0 0 8px">Đoạn này dùng file âm thanh tự chèn — các ô chữ đọc bên dưới không dùng tới; xóa file thì giọng AI đọc lại.</p>' : '';
    box.innerHTML = note + items.map((it, i) => `<label class="preview-tts-item"><span>Chữ đọc · @${esc(it.author.username)}</span><textarea class="preview-tts-ta" data-item="${i}" rows="2" placeholder="Để trống thì đoạn này im lặng">${esc(it.ttsText ?? it.content)}</textarea></label>`).join('');
    box.querySelectorAll('.preview-tts-ta').forEach((ta) => ta.addEventListener('input', (e) => {
      const it = items[Number(e.target.dataset.item)];
      if (it) { it.ttsText = e.target.value; renderSegments(); }
    }));
  } else {
    box.querySelectorAll('.preview-tts-ta').forEach((ta) => {
      const it = items[Number(ta.dataset.item)];
      const v = it ? (it.ttsText ?? it.content) : '';
      if (it && document.activeElement !== ta && ta.value !== v) ta.value = v;
    });
  }
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
  // Đổi đoạn: khôi phục ngay thẻ thật đã cache (đúng nội dung) trong
  // lần vẽ này, khỏi chớp bản mô phỏng; chưa có cache thì để trạng
  // thái chờ dựng, không hiện mô phỏng cũ trước.
  if (!seg) { embedShotView.key = null; embedShotView.shots = null; }
  else if (embedShotView.key !== seg.key) {
    embedShotView.key = seg.key;
    const cached = currentCardStyle() !== 'hand' ? realShotCache.get(seg.key) : null;
    embedShotView.shots = (cached && cached.hash === shotHash(seg)) ? cached.shots : null;
  }
  const select = $('#previewSegSelect');
  select.innerHTML = segs.map((s, i) => { const first = segItems(s)[0]; return `<option value="${i}" ${i === preview.index ? 'selected' : ''}>${i + 1}. ${s.kind === 'post' ? 'Bài gốc' : 'Bình luận'} @${esc(first?.author.username || '?')}${segItems(s).length > 1 ? ` +${segItems(s).length - 1} trả lời` : ''}</option>`; }).join('');
  if (!seg) {
    $('#previewCard').classList.remove('real');
    $('#previewEmbedShots').hidden = true; $('#previewEmbedShots').innerHTML = '';
    $('#previewCardItems').innerHTML = `<div class="preview-item"><div class="preview-card-head"><span class="preview-avatar">?</span><span class="preview-names"><strong>Chưa có đoạn nào</strong></span></div><p class="preview-content">Cào link hoặc bấm “Dùng dữ liệu demo” để xem thẻ bình luận hiện lên đúng như trong video xuất ra.</p></div>`;
    $('#previewTtsBox') && renderPreviewTtsBox(null);
    $('#previewBadge').textContent = '0 / 0';
    $('#previewInfo').textContent = 'Chưa có đoạn nào được đưa vào video.';
    $('#previewMeme').hidden = true;
    return;
  }
  const items = segItems(seg);
  const shotsBox = $('#previewEmbedShots');
  const card = $('#previewCard');
  if (embedShotView.shots) {
    // Hiện đúng thẻ thật đã dựng, thay cho bản mô phỏng — không còn
    // khung đen ngoài bao quanh làm thẻ bị bé lại.
    $('#previewCardItems').innerHTML = '';
    shotsBox.hidden = false;
    shotsBox.innerHTML = embedShotView.shots.map((s) => `<img src="${esc(s.pngUrl)}" alt="Thẻ Threads">`).join('');
    card.classList.add('real');
  } else if (shotPending.has(seg.key) && currentCardStyle() !== 'hand') {
    // Đang dựng thẻ thật: hiện dòng chờ, không chớp bản mô phỏng cũ.
    shotsBox.hidden = true; shotsBox.innerHTML = '';
    $('#previewCardItems').innerHTML = '<div class="preview-loading">Đang dựng thẻ thật…</div>';
    card.classList.remove('real');
  } else {
    card.classList.remove('real');
    shotsBox.hidden = true; shotsBox.innerHTML = '';
    $('#previewCardItems').innerHTML = items.map((it, i) => `
    <div class="preview-item ${i > 0 ? 'reply' : ''}">
      <div class="preview-card-head">
        <span class="preview-avatar" style="background:${avatarColor(it.author.username)}">${it.author.avatarUrl ? `<img src="${esc(it.author.avatarUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${esc(avatarLetter(it.author.username))}</span>
        <span class="preview-names"><strong>@${esc(it.author.username)}</strong><small>${esc(formatTimeLabel(it.timestamp, it.timeLabel))}</small></span>
      </div>
      <p class="preview-content">${esc(it.content)}</p>
      <p class="preview-stats">${esc(statsLine(it.stats))}</p>
    </div>`).join('');
  }
  renderPreviewTtsBox(seg);
  const kindLabel = seg.kind === 'post' ? 'BÀI GỐC' : (items.length > 1 ? `CHUỖI · ${items.length} BÌNH LUẬN` : 'BÌNH LUẬN');
  $('#previewBadge').textContent = `${preview.index + 1} / ${segs.length} · ${kindLabel}`;
  const rate = parseInt($('#rate').value, 10) || 0;
  const durs = segs.map((s) => segEstDuration(s, rate));
  const total = durs.reduce((a, b) => a + b, 0);
  $('#previewInfo').textContent = `Đoạn này khoảng ${durs[preview.index].toFixed(1)} giây (ước lượng theo giọng đọc). Cả video khoảng ${total.toFixed(1)} giây, chưa tính thời gian render thật.`;
  if (embedShotView.shots) $('#previewInfo').textContent += parseEmbedCode(seg.embedCode || '') ? ' Đang hiện thẻ embed Threads chính thức từ mã embed đã dán cho đoạn này — đúng thẻ sẽ dùng trong video.' : ' Đang hiện thẻ thật giống Threads — đúng thẻ sẽ dùng trong video khi chọn kiểu thẻ này.';
  else if (lastShotError && lastShotError.segKey === seg.key) $('#previewInfo').textContent += ' Không dựng được thẻ thật: ' + lastShotError.msg + ' — đang hiện bản mô phỏng.';
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
  markShotPending(segs[preview.index]);
  renderPreview();
  ensureRealShot(segs[preview.index]);
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
  preview.timer = setTimeout(() => { preview.index += 1; renderPreview(); playPreviewStep(); }, segEstDuration(seg, rate) * 1000);
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
      </label>
      <label>Embed Threads thay thẻ này (dán mã embed, để trống thì dùng thẻ thường):
        <textarea class="seg-embed" rows="2" placeholder="Dán mã <blockquote class=&quot;text-post-media&quot; ...> lấy từ nút … → Get embed code của bài Threads">${esc(seg.embedCode || '')}</textarea>
      </label>
      <p class="hint seg-embed-status" style="margin:0"></p>
      <label>Âm thanh tự chèn thay giọng AI (để trống thì dùng giọng AI):
        <input type="file" class="seg-voice-file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac">
      </label>
      <p class="hint seg-voice-status" style="margin:0"></p>
      <audio class="seg-voice-preview" controls hidden></audio>
      <p style="margin:6px 0 0"><button type="button" class="seg-voice-clear" hidden>Xóa file, dùng lại giọng AI</button></p>`;
    div.querySelectorAll('.seg-content').forEach((ta) => ta.addEventListener('input', (e) => { items[Number(e.target.dataset.item)].content = e.target.value; renderPreview(); scheduleShotRefresh(seg); }));
    div.querySelectorAll('.seg-tts').forEach((ta) => ta.addEventListener('input', (e) => { items[Number(e.target.dataset.item)].ttsText = e.target.value; renderPreview(); }));
    div.querySelector('.seg-include').addEventListener('change', (e) => { seg.include = e.target.checked; renderPreview(); });
    div.querySelector('.seg-meme').addEventListener('change', (e) => { seg.memeId = e.target.value; renderPreview(); });
    const embedTa = div.querySelector('.seg-embed');
    const embedStatus = div.querySelector('.seg-embed-status');
    const refreshEmbedStatus = () => {
      const u = parseEmbedCode(embedTa.value);
      embedStatus.textContent = embedTa.value.trim()
        ? (u ? '✓ Đoạn này sẽ dùng thẻ embed chính thức của: ' + u : '⚠ Chưa nhận ra link Threads trong mã embed — kiểm tra lại mã đã dán.')
        : '';
    };
    embedTa.addEventListener('input', (e) => { seg.embedCode = e.target.value; refreshEmbedStatus(); renderPreview(); scheduleShotRefresh(seg); });
    refreshEmbedStatus();
    const voiceFile = div.querySelector('.seg-voice-file');
    const voiceStatus = div.querySelector('.seg-voice-status');
    const voicePreview = div.querySelector('.seg-voice-preview');
    const voiceClear = div.querySelector('.seg-voice-clear');
    const refreshVoiceUI = () => {
      const va = seg.voiceAudio;
      if (va) {
        voiceStatus.textContent = `✓ Đoạn này dùng file âm thanh của anh: ${va.name}${va.seconds ? ` (${va.seconds.toFixed(1)} giây)` : ''} — không dùng giọng AI.`;
        voicePreview.src = uploadUrl(va); voicePreview.hidden = false; voiceClear.hidden = false;
      } else {
        voiceStatus.textContent = '';
        voicePreview.removeAttribute('src'); voicePreview.load(); voicePreview.hidden = true; voiceClear.hidden = true;
      }
    };
    voiceFile.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      voiceStatus.textContent = 'Đang tải file âm thanh lên…';
      try {
        const j = await uploadFile(f);
        seg.voiceAudio = { id: j.id, name: j.name };
        // Lấy thời lượng file để ước lượng độ dài đoạn trong khung xem trước.
        const probe = new Audio(uploadUrl(seg.voiceAudio));
        probe.addEventListener('loadedmetadata', () => { seg.voiceAudio.seconds = probe.duration || 0; refreshVoiceUI(); renderPreview(); });
        refreshVoiceUI(); renderPreview();
      } catch (err) { voiceStatus.textContent = '❌ Tải file thất bại: ' + err.message; }
      e.target.value = '';
    });
    voiceClear.addEventListener('click', () => { seg.voiceAudio = null; refreshVoiceUI(); renderPreview(); });
    refreshVoiceUI();
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
  // Cào xong thì tự dựng thẻ thật cho đoạn đầu, không cần bấm nút nào.
  preview.index = 0;
  const vis = visibleSegments();
  if (vis.length) { markShotPending(vis[0]); renderPreview(); ensureRealShot(vis[0]); }
  status($('#scrapeStatus'), `Đã có bài viết gốc của @${data.post?.author?.username || '?'} và ${data.comments?.length || 0} bình luận nhiều tim nhất (${data.source || 'live'}), gộp thành ${chains.length} chuỗi hội thoại theo đúng thứ tự trên Threads. Kiểm tra và sửa kịch bản ở mục 2 rồi xuất video.` + (data.diagnostic ? ` Số liệu bài gốc đang 0 — tool đã lưu file chẩn đoán DOM, bấm link “Tải file chẩn đoán DOM” bên dưới để tải và gửi mình file đó.` : ''));
  const dg = $('#diagnosticLink');
  if (dg) {
    if (data.diagnostic) { dg.href = '/debug/' + encodeURIComponent(data.diagnostic); dg.hidden = false; }
    else dg.hidden = true;
  }
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

$('#cardStyle')?.addEventListener('change', () => {
  // Đổi kiểu thẻ thì thẻ thật cũ không còn đúng nữa: dựng lại đoạn đang xem.
  realShotCache.clear(); lastShotError = null; shotPending.clear();
  embedShotView.key = null; embedShotView.shots = null;
  const vis = visibleSegments();
  if (vis[preview.index]) markShotPending(vis[preview.index]);
  renderPreview();
  if (vis[preview.index]) ensureRealShot(vis[preview.index]);
});
$('#btnPrevSeg').addEventListener('click', () => { stopPreviewPlay(); setPreviewIndex(preview.index - 1); });
$('#btnNextSeg').addEventListener('click', () => { stopPreviewPlay(); setPreviewIndex(preview.index + 1); });
$('#btnPlayPreview').addEventListener('click', togglePreviewPlay);
$('#previewSegSelect').addEventListener('change', (e) => { stopPreviewPlay(); setPreviewIndex(parseInt(e.target.value, 10) || 0); });
$('#watermark').addEventListener('input', renderPreview);
$('#watermarkPosition').addEventListener('change', renderPreview);
$('#voice').addEventListener('change', renderPreview);

$('#btnScrape').addEventListener('click', () => doScrape('live'));
$('#btnDemo').addEventListener('click', () => doScrape('demo'));
$('#btnTtsTest')?.addEventListener('click', async () => {
  const btn = $('#btnTtsTest'), st = $('#ttsTestStatus'), audio = $('#ttsTestAudio');
  btn.disabled = true;
  st.textContent = 'Đang thử giọng đọc… (tối đa ~2 phút, cần mạng tới Edge TTS hoặc Google)';
  audio.hidden = true; audio.removeAttribute('src'); audio.load();
  try {
    const r = await fetch('/api/tts-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: $('#voice').value }) });
    const j = await r.json();
    if (j.ok) {
      const engineLabel = j.engine === 'gtts' ? 'giọng Google dự phòng (tiếng Việt, không phải Hoài My/Nam Minh — muốn giọng Hoài My thì cài lại Edge theo lỗi ở dưới, hoặc đợi Microsoft sửa máy chủ cũ)' : j.engine === 'edge-tts-new' ? 'Edge qua máy chủ mới (đúng giọng đã chọn)' : 'Edge (đúng giọng đã chọn)';
      st.textContent = `✅ Giọng đọc chạy được qua ${engineLabel}: file ${j.seconds} giây — đang phát thử, nếu không nghe thấy thì bấm nút play trên thanh âm thanh bên dưới. Video xuất ra sẽ dùng đúng đường giọng này.`;
      audio.src = j.audioUrl; audio.hidden = false; audio.load();
      audio.play().catch(() => { st.textContent += ' (Trình duyệt chặn tự phát — bấm nút play trên thanh âm thanh để nghe.)'; });
    } else {
      st.textContent = `❌ Giọng đọc không chạy được trên máy này: ${j.error} — video xuất ra sẽ im lặng (chỉ có hình). Gửi mình dòng này để sửa tiếp.`;
    }
  } catch (e) { st.textContent = '❌ Không gọi được máy chủ thử giọng: ' + e.message; }
  finally { btn.disabled = false; }
});
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
      author: it.author, content: it.content, ttsText: it.ttsText ?? it.content,
      timeLabel: formatTimeLabel(it.timestamp, it.timeLabel), stats: it.stats, depth: it.depth || 0,
      url: it.url || '',
    }));
    const first = items[0];
    return {
      kind: s.kind, author: first.author, content: first.content, ttsText: first.ttsText,
      timeLabel: first.timeLabel, stats: first.stats, url: first.url || '', items: items.length > 1 ? items : undefined,
      embedCode: s.embedCode || '',
      voiceAudio: s.voiceAudio ? { id: s.voiceAudio.id, name: s.voiceAudio.name } : null,
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
        cardStyle: $('#cardStyle') ? $('#cardStyle').value : 'replica',
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
        const ll = $('#logLink'); ll.href = '/api/jobs/' + j.id + '/log'; ll.hidden = false;
        status($('#renderStatus'), 'Xong! Xem trước ở trên, bấm “Tải video xuống” để lấy file MP4.' + (job.ttsWarning ? ' ⚠ ' + job.ttsWarning : ''));
      } else if (job.status === 'error') {
        clearInterval(poll); btn.disabled = false;
        const ll = $('#logLink'); ll.href = '/api/jobs/' + j.id + '/log'; ll.hidden = false;
        status($('#renderStatus'), 'Lỗi: ' + (job.error || 'Không rõ.'));
      }
    }, 3000);
  } catch (e) { btn.disabled = false; status($('#renderStatus'), 'Lỗi: ' + e.message); }
});

renderSegments();
