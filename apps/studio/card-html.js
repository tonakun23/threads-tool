/**
 * HTML/CSS của thẻ replica giống giao diện Threads bản tối (dùng chung
 * cho card-shot.js CLI và server.js chụp trong tiến trình).
 * Thuần hàm, không có side effect — import ở đâu cũng an toàn.
 */

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Số rút gọn kiểu Việt Nam, cùng quy ước với threads-parse.js:
// 10800 -> 10,8K · 1400 -> 1,4K · 1000000 -> 1M.
export function formatCompact(n) {
  const v = Number(n) || 0;
  const trim = (x) => (Math.round(x * 10) / 10).toString().replace('.', ',');
  if (v >= 1e9) return trim(v / 1e9) + 'B';
  if (v >= 1e6) return trim(v / 1e6) + 'M';
  if (v >= 1e3) return trim(v / 1e3) + 'K';
  return String(v);
}

export function avatarLetter(username) {
  const m = String(username || '').match(/[A-Za-z0-9À-ỹ]/);
  return (m ? m[0] : '?').toUpperCase();
}

export function avatarColor(username) {
  let h = 0;
  for (const ch of String(username || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 65% 55%)`;
}

const ICONS = {
  likes: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  replies: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  reposts: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  shares: '<svg viewBox="0 0 24 24" fill="none" stroke="#d4d4d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
};

function itemHtml(it, idx) {
  const a = it.author || {};
  const username = a.username || 'unknown';
  const stats = it.stats || {};
  const avatarUrl = String(a.avatarUrl || '');
  const avatar = avatarUrl
    ? `<span class="avatar" style="background:${avatarColor(username)}"><span class="avatar-letter">${esc(avatarLetter(username))}</span><img src="${esc(avatarUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
    : `<span class="avatar" style="background:${avatarColor(username)}"><span class="avatar-letter">${esc(avatarLetter(username))}</span></span>`;
  const verified = a.isVerified ? '<span class="verified">✓</span>' : '';
  const time = it.timeLabel ? `<span class="time">${esc(it.timeLabel)}</span>` : '';
  const statRow = ['likes', 'replies', 'reposts', 'shares']
    .map((k) => `<span class="stat">${ICONS[k]}<span>${esc(formatCompact(stats[k]))}</span></span>`).join('');
  return `<div class="item${idx > 0 ? ' reply' : ''}">`
    + `<div class="avatar-col">${avatar}</div>`
    + `<div class="main-col"><div class="head"><span class="name">@${esc(username)}</span>${verified}${time}</div>`
    + `<div class="content">${esc(it.content || '')}</div>`
    + `<div class="stats">${statRow}</div></div></div>`;
}

export function cardHtml(items) {
  const list = (Array.isArray(items) && items.length ? items : [{ author: { username: 'unknown' }, content: '' }]);
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>'
    + 'html,body{margin:0;padding:0;background:#000}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}'
    + '#card{width:980px;box-sizing:border-box;background:#141414;color:#fff;border:1px solid #333;border-radius:28px;padding:40px 44px;position:relative}'
    + '.logo{position:absolute;top:34px;right:44px;width:48px;height:48px;border:3px solid #d4d4d4;border-radius:50%;color:#fff;font-size:30px;font-weight:700;display:flex;align-items:center;justify-content:center}'
    + '.item{display:flex;gap:18px;margin-bottom:28px}.item:last-child{margin-bottom:0}'
    + '.item.reply{margin-left:58px;padding-left:20px;border-left:3px solid #4a4a4a}'
    + '.avatar-col{flex:0 0 auto}'
    + '.avatar{position:relative;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;overflow:hidden;color:#fff;font-size:34px;font-weight:700}'
    + '.reply .avatar{width:56px;height:56px;font-size:26px}'
    + '.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'
    + '.main-col{flex:1;min-width:0;padding-right:70px}'
    + '.reply .main-col{padding-right:0}'
    + '.head{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}'
    + '.name{font-size:34px;font-weight:700;line-height:1.2}'
    + '.reply .name{font-size:30px}'
    + '.verified{color:#3797ef;font-size:26px;font-weight:700}'
    + '.time{color:#a3a3a3;font-size:28px}'
    + '.content{font-size:38px;line-height:1.45;white-space:pre-wrap;overflow-wrap:break-word}'
    + '.reply .content{font-size:34px}'
    + '.stats{display:flex;gap:34px;margin-top:18px;color:#d4d4d4}'
    + '.stat{display:flex;align-items:center;gap:9px;font-size:27px}'
    + '.stat svg{width:27px;height:27px}'
    + '</style></head><body>'
    + '<div id="card"><div class="logo">@</div>'
    + list.map(itemHtml).join('')
    + '</div></body></html>';
}
