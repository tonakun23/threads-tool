/**
 * Trích xuất bài viết + bình luận từ DOM trang Threads — logic thuần,
 * không phụ thuộc Node, để dùng được cả 2 nơi:
 *  - trong trình duyệt (Playwright page.evaluate, scraper.js đọc file này
 *    thành chuỗi và chạy trong trang),
 *  - trong test Node/jsdom (import trực tiếp).
 *
 * NGUYÊN TẮC (rút ra từ video mẫu + ảnh chụp lỗi của Tony, 31/10):
 *  1. Một bài = một đơn vị `div[tabindex="0"]` (hoặc <article> /
 *     [role="article"] nếu DOM mới đổi khung). Không đi ngược lên
 *     container to chứa cả chuỗi trả lời — đó là lý do nội dung bị lẫn
 *     "856K lượt xem", "20 giờ", "Tác giả", cả nội dung của bình luận
 *     con vào bài cha.
 *  2. Giữ nguyên thứ tự trên trang (hội thoại), KHÔNG sắp xếp theo like.
 *  3. Chuỗi trả lời (reply lồng nhau) được giữ qua parentId/depth để
 *     hiển thị gộp trong một thẻ, giống ảnh chụp màn hình Threads.
 *  4. Chỉ lấy khối chữ nội dung thật; lọc lượt xem, giờ, nhãn giao diện.
 *  5. Số kiểu Việt Nam: "10,8K" = 10800, "1,4K" = 1400 (dấu phẩy thập phân).
 */

function parseStatNumber(raw) {
  if (raw == null) return 0;
  const m = String(raw).toLowerCase().replace(/\u00a0/g, ' ').trim()
    .match(/([\d.,\s]+)\s*(triệu|nghìn|tr|k|m)?/);
  if (!m) return 0;
  let numPart = m[1].replace(/\s/g, '');
  const unit = m[2] || '';
  let n;
  if (/^\d+,\d{1,2}$/.test(numPart)) {
    // "10,8" — dấu phẩy là thập phân (kiểu Việt Nam).
    n = parseFloat(numPart.replace(',', '.'));
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(numPart)) {
    n = parseFloat(numPart.replace(/,/g, ''));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(numPart)) {
    // "1.234" — dấu chấm phân tách nghìn (kiểu Việt Nam), không phải thập phân.
    n = parseFloat(numPart.replace(/\./g, ''));
  } else if (numPart.includes(',') && numPart.includes('.')) {
    n = parseFloat(numPart.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d+,\d+$/.test(numPart)) {
    // "10,800" không có hậu tố: phẩy là phân tách nghìn.
    n = parseFloat(numPart.replace(/,/g, ''));
  } else {
    n = parseFloat(numPart.replace(/,/g, ''));
  }
  if (!isFinite(n)) return 0;
  if (unit === 'triệu' || unit === 'tr' || unit === 'm') n *= 1000000;
  else if (unit === 'nghìn' || unit === 'k') n *= 1000;
  return Math.round(n);
}

function formatCompact(n) {
  const v = Number(n) || 0;
  const fmt1 = (x) => {
    const s = (Math.round(x * 10) / 10).toString().replace('.', ',');
    return s.endsWith(',0') ? s.slice(0, -2) : s;
  };
  if (v >= 1000000) return fmt1(v / 1000000) + 'M';
  if (v >= 1000) return fmt1(v / 1000) + 'K';
  return String(v);
}

function formatTimeLabel(ts, nowMs) {
  const raw = String(ts || '').trim();
  if (!raw) return '';
  // Đã là giờ tương đối tiếng Việt / dạng ngắn: giữ nguyên, không hiện ISO.
  if (/^\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)(\s+trước)?$/i.test(raw)) return raw;
  if (/^\d+\s*(s|m|h|d|w)$/i.test(raw)) return raw;
  if (/^\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)$/i.test(raw)) return raw;
  const t = Date.parse(raw);
  if (isNaN(t)) return raw.length <= 20 ? raw : '';
  const now = nowMs || Date.now();
  const diff = Math.max(0, now - t);
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

function isJunkText(t, username, displayName) {
  const s = String(t || '').trim();
  if (!s) return true;
  if (username && s === username) return true;
  if (displayName && s === displayName) return true;
  // Bỏ dấu câu cuối khi xét mẫu rác: "856K lượt xem." vẫn là lượt xem.
  const clean = s.replace(/[.,;:!?…]+$/, '');
  const low = clean.toLowerCase();
  if (/^[\d.,\s]+[kkm]?$/.test(clean)) return true;
  if (/^\d[\d.,\s]*(triệu|nghìn|tr|k|m)?\s*(lượt xem|views?|lượt thích)$/i.test(clean)) return true;
  if (/^\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)(\s+trước)?$/i.test(clean)) return true;
  if (/^(?:\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm)\s*)+(?:trước)?$/i.test(clean)) return true;
  if (/^\d+[smhd]$/i.test(clean)) return true;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(clean)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return true;
  if (/^(tác giả|author|đã ghim|pinned|dịch|translate|learn more|tìm hiểu thêm|xem thêm|see more|show more|trả lời|reply|thích|like|bình luận|comment|chia sẻ|share|đăng lại|repost|theo dõi|follow|đang theo dõi|xem bản dịch|view translation|đã thích|liked)$/i.test(clean)) return true;
  if (/^https?:\/\/\S+$/.test(clean)) return true;
  if (low.includes('trouble playing this video')) return true;
  return false;
}

function postIdFromHref(href) {
  const m = String(href || '').match(/\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/);
  if (m) return { username: m[1], id: m[2] };
  // Dạng rút gọn /post/<id> (không có @user): vẫn lấy được id, tên
  // user sẽ suy ra từ link hồ sơ gần nhất trong khung bài.
  const m2 = String(href || '').match(/\/post\/([A-Za-z0-9_-]+)/);
  return m2 ? { username: null, id: m2[1] } : null;
}

function isInside(el, ancestor) {
  let cur = el;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parentElement;
  }
  return false;
}

// Khung của một bài: ưu tiên div[tabindex="0"] (DOM cũ), rồi <article>
// hoặc [role="article"] (DOM mới), rồi đi ngược tìm khung có nút thống
// kê / thẻ time. Threads đổi khung theo đợt nên phải có nhiều đường lui.
const UNIT_SELECTOR = 'div[tabindex="0"], article, [role="article"]';
function unitOf(el) {
  return el ? el.closest(UNIT_SELECTOR) : null;
}
function findUnit(link) {
  let unit = link.closest('div[tabindex="0"]');
  if (unit) return unit;
  unit = link.closest('article') || link.closest('[role="article"]');
  if (unit) return unit;
  let el = link.parentElement;
  let depth = 0;
  while (el && depth < 12) {
    const btns = el.querySelectorAll('div[role="button"]');
    let stats = 0;
    for (const b of btns) {
      if (/like|comment|repost|share|thích|bình luận|chia sẻ/i.test(b.textContent || '')) stats++;
    }
    if (stats >= 2) return el;
    if (el.querySelector('time') && el.querySelector('a[href*="/post/"]')) return el;
    el = el.parentElement; depth++;
  }
  return null;
}

function extractPosts(doc) {
  const links = Array.from(doc.querySelectorAll('a[href*="/post/"]'));
  const seen = new Set();
  const records = [];
  const unitById = new Map();
  const idByUnit = new Map();

  for (const link of links) {
    const parsed = postIdFromHref(link.getAttribute('href') || '');
    if (!parsed || seen.has(parsed.id)) continue;
    // Đơn vị gần nhất: div[tabindex="0"] / article / role=article, lui
    // dần tới khung có nút thống kê hoặc thẻ time (xem findUnit).
    const unit = findUnit(link);
    if (!unit) continue;
    // Link trích dẫn (quoted post) nằm chung đơn vị với bài khác thì
    // không phải một bài riêng — bỏ qua, nội dung trích dẫn cũng bị lọc.
    if (idByUnit.has(unit) && idByUnit.get(unit) !== parsed.id) continue;
    seen.add(parsed.id);
    idByUnit.set(unit, parsed.id);

    // Tên user: từ href, hoặc suy ra từ link hồ sơ trong khung (dạng
    // link rút gọn /post/<id> không có @user).
    let username = parsed.username;
    if (!username) {
      const prof = unit.querySelector('a[href^="/@"]');
      const pm = prof ? String(prof.getAttribute('href') || '').match(/^\/@([^/?#]+)/) : null;
      username = pm ? pm[1] : 'unknown';
    }
    const nameLink = unit.querySelector('a[href="/@' + username + '"]');
    let displayName = (nameLink ? (nameLink.textContent || '') : '').trim();
    if (!displayName || displayName === username) displayName = username;
    // Avatar: ưu tiên ảnh có alt profile/avatar/picture, không lấy ảnh
    // nội dung đứng trước avatar; loại ảnh của bình luận lồng nhau.
    const unitImgs = Array.from(unit.querySelectorAll('img')).filter((im) => {
      const u = unitOf(im);
      return !u || u === unit;
    });
    const avatarImg = unitImgs.find((im) => /profile|avatar|picture/i.test(im.getAttribute('alt') || '')) || unitImgs[0];
    const timeEl = unit.querySelector('time');
    const timeRaw = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent || '') : '';

    // Nội dung: chỉ khối lá div/span[dir="auto"] trong đơn vị này.
    // Nếu DOM mới không còn dir="auto", lui về mọi khối lá div/span/p
    // (chỉ lấy khi không có khối dir="auto" nào, tránh trùng lặp).
    // Loại khối nằm trong đơn vị con (bình luận lồng nhau), nút, link,
    // time, và khối thuộc bài trích dẫn (quoted post khác id).
    let candidates = Array.from(unit.querySelectorAll('div[dir="auto"], span[dir="auto"]'));
    const usingFallback = candidates.length === 0;
    if (usingFallback) candidates = Array.from(unit.querySelectorAll('div, span, p'));
    const rawBlocks = [];
    for (const el of candidates) {
      if (el.closest('[role="button"]') || el.closest('time')) continue;
      if (usingFallback && el.querySelector('div, span, p')) continue;
      // Khối nằm trong/chứa link tới bài KHÁC id = thẻ trích dẫn (quoted):
      // dạng div > a[href=/post/Q99] mà link của chính bài nằm ở tổ tiên
      // nên vòng kiểm tra tổ tiên không phát hiện được.
      const selfLink = el.closest('a[href*="/post/"]');
      if (selfLink) {
        const lp = postIdFromHref(selfLink.getAttribute('href') || '');
        if (lp && lp.id !== parsed.id) continue;
      }
      const innerLink = el.querySelector('a[href*="/post/"]');
      if (innerLink) {
        const lp = postIdFromHref(innerLink.getAttribute('href') || '');
        if (lp && lp.id !== parsed.id) continue;
      }
      if (el.closest('a') && el.closest('a') !== nameLink) {
        // Khối chữ nằm hẳn trong một link khác (tên, hashtag link...) thì
        // vẫn lấy nếu chính nó là khối nội dung; bỏ qua link tên tác giả.
        if (isInside(el, nameLink)) continue;
      }
      // Nằm trong đơn vị con khác?
      const nestedUnit = unitOf(el);
      if (nestedUnit && nestedUnit !== unit) continue;
      // Thuộc bài trích dẫn (quoted)? Một khối bị coi là trích dẫn khi
      // một tổ tiên (tới khung bài) chứa link /post/ tới bài KHÁC id mà
      // link đó thuộc chính khung này — link của đơn vị con lồng nhau
      // thì không tính (khối của đơn vị con đã bị loại ở bước trên).
      let quoted = false;
      let anc = el.parentElement;
      while (anc && anc !== unit) {
        const qs = anc.querySelectorAll('a[href*="/post/"]');
        for (const q of qs) {
          const qp = postIdFromHref(q.getAttribute('href') || '');
          if (qp && qp.id !== parsed.id) {
            const qUnit = unitOf(q);
            if (!qUnit || qUnit === unit) { quoted = true; break; }
          }
        }
        if (quoted) break;
        anc = anc.parentElement;
      }
      if (quoted) continue;
      // Chỉ lấy khối lá: bỏ khối cha nếu đã có khối con cùng chữ.
      const hasChildBlock = el.querySelector('div[dir="auto"], span[dir="auto"]');
      if (hasChildBlock) continue;
      const text = (el.textContent || '').trim();
      if (isJunkText(text)) continue;
      if (!text) continue;
      if (!rawBlocks.includes(text)) rawBlocks.push(text);
    }
    // Khối đầu tiên trùng đúng tên tác giả mà còn khối khác phía sau thì
    // đó là tên hiển thị lọt vào, bỏ. Chỉ còn đúng 1 khối trùng tên thì
    // giữ — đó là toàn bộ nội dung bài (bài đăng đúng tên mình).
    let blocks = rawBlocks;
    if (blocks.length > 1 && (blocks[0] === username || blocks[0] === displayName)) blocks = blocks.slice(1);
    let content = blocks.join('\n\n').trim();
    // Cắt phần đuôi là nhãn giao diện nếu lọt vào.
    content = content.split('\n').filter((line) => !isJunkText(line.trim())).join('\n').trim();
    if (!content) continue;

    // Thống kê: nút trong đơn vị này, loại nút của đơn vị con.
    // Nhận diện theo từ khóa (aria-label/text); nút không nhãn thì gán
    // theo thứ tự cố định của Threads: Thích, Bình luận, Đăng lại, Chia sẻ.
    const statOrder = ['likes', 'replies', 'reposts', 'shares'];
    const stats = { likes: 0, replies: 0, reposts: 0, shares: 0 };
    const taken = new Set();
    const unlabeled = [];
    const btns = Array.from(unit.querySelectorAll('div[role="button"], button'));
    for (const b of btns) {
      const nestedUnit = unitOf(b);
      if (nestedUnit && nestedUnit !== unit) continue;
      // aria-label có thể nằm ở chính nút hoặc ở svg con trong nút.
      const childAria = Array.from(b.querySelectorAll('[aria-label]')).map((x) => x.getAttribute('aria-label') || '').join(' ');
      const label = childAria + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      if (!/\d/.test(label)) continue;
      const numToken = (label.match(/[\d][\d.,\s]*\s*(triệu|nghìn|tr|k|m)?/i) || ['0'])[0];
      const v = parseStatNumber(numToken);
      const low = label.toLowerCase();
      let kind = null;
      if (/like|thích|tim/i.test(low)) kind = 'likes';
      else if (/comment|reply|bình luận|trả lời/i.test(low)) kind = 'replies';
      else if (/repost|đăng lại/i.test(low)) kind = 'reposts';
      else if (/share|chia sẻ/i.test(low)) kind = 'shares';
      if (kind) { stats[kind] = v; taken.add(kind); }
      else unlabeled.push(v);
    }
    for (const v of unlabeled) {
      const empty = statOrder.find((k) => !taken.has(k));
      if (empty) { stats[empty] = v; taken.add(empty); }
    }
    let likes = stats.likes, replies = stats.replies, reposts = stats.reposts, shares = stats.shares;
    const verified = Array.from(unit.querySelectorAll('svg, img')).some((el) => {
      const u = unitOf(el);
      if (u && u !== unit) return false;
      const lab = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('alt') || '')).toLowerCase();
      return lab.includes('verified') || lab.includes('xác minh');
    });

    const rec = {
      id: parsed.id,
      url: username === 'unknown'
        ? 'https://www.threads.com/post/' + parsed.id
        : 'https://www.threads.com/@' + username + '/post/' + parsed.id,
      author: {
        username,
        displayName,
        profileUrl: 'https://www.threads.com/@' + username,
        avatarUrl: avatarImg ? (avatarImg.getAttribute('src') || undefined) : undefined,
        isVerified: verified,
      },
      content,
      timestamp: timeRaw,
      timeLabel: formatTimeLabel(timeRaw),
      stats: { likes, replies, reposts, shares },
      parentId: null,
      depth: 0,
      _unit: unit,
    };
    records.push(rec);
    unitById.set(parsed.id, rec);
  }

  // Cha / độ sâu: đơn vị tổ tiên gần nhất cũng là một bài.
  for (const rec of records) {
    let anc = rec._unit.parentElement;
    let depth = 0;
    let parentId = null;
    while (anc) {
      const ancUnit = anc.closest ? unitOf(anc) : null;
      if (!ancUnit || ancUnit === rec._unit) break;
      const ancLink = ancUnit.querySelector('a[href*="/post/"]');
      const ancParsed = ancLink ? postIdFromHref(ancLink.getAttribute('href') || '') : null;
      if (ancParsed && ancParsed.id !== rec.id && unitById.has(ancParsed.id)) {
        parentId = ancParsed.id;
        depth = (unitById.get(ancParsed.id).depth || 0) + 1;
        break;
      }
      anc = ancUnit.parentElement;
    }
    rec.parentId = parentId;
    rec.depth = depth;
  }
  // Tính lại depth cho chuỗi lồng nhiều tầng (cha đã có depth).
  // Bài trả lời trực tiếp bài gốc (parent = bài đầu tiên) tính là
  // bình luận cấp 0, không phải reply của một bình luận khác.
  const mainId = records.length ? records[0].id : null;
  for (const rec of records) {
    if (rec.parentId === mainId) { rec.parentId = null; rec.depth = 0; }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const rec of records) {
      const want = rec.parentId && unitById.has(rec.parentId) ? unitById.get(rec.parentId).depth + 1 : 0;
      if (rec.depth !== want) { rec.depth = want; changed = true; }
    }
  }
  for (const rec of records) delete rec._unit;
  return records;
}

function groupIntoChains(posts) {
  if (!posts || !posts.length) return { post: null, chains: [] };
  const post = posts[0];
  const chains = [];
  const byId = new Map();
  for (const p of posts.slice(1)) {
    byId.set(p.id, p);
    if (!p.parentId || p.depth === 0) {
      chains.push({ root: p, replies: [] });
    } else {
      // Gắn vào chuỗi chứa cha (cha có thể là reply của chuỗi trước).
      let target = chains.find((c) => c.root.id === p.parentId || c.replies.some((r) => r.id === p.parentId));
      if (!target) target = chains[chains.length - 1];
      if (target) target.replies.push(p);
      else chains.push({ root: p, replies: [] });
    }
  }
  return { post, chains };
}

export { parseStatNumber, formatCompact, formatTimeLabel, isJunkText, extractPosts, groupIntoChains };
