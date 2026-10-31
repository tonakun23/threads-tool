/** Chạy: node tests/run-parse-tests.mjs (cần jsdom: xem tests/README.md)
 * 55 assertion, chia nhóm A–G. In PASS/FAIL từng ca, exit 1 nếu có ca fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseStatNumber, formatCompact, formatTimeLabel, isJunkText, extractPosts, groupIntoChains } from '../threads-parse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (name) => new JSDOM(readFileSync(join(HERE, 'fixtures', name), 'utf8')).window.document;
let pass = 0, fail = 0;
const cases = [];
function check(id, name, cond, extra) {
  cases.push({ id, name, ok: !!cond, extra: cond ? undefined : extra });
  if (cond) pass++; else { fail++; console.log('FAIL ' + id + ' ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A: số kiểu Việt Nam (10 ca)
check('A01', '10,8K = 10800', parseStatNumber('10,8K') === 10800, parseStatNumber('10,8K'));
check('A02', '1,4K = 1400', parseStatNumber('1,4K') === 1400, parseStatNumber('1,4K'));
check('A03', '6,5K = 6500', parseStatNumber('6,5K') === 6500, parseStatNumber('6,5K'));
check('A04', '1,2 triệu = 1200000', parseStatNumber('1,2 triệu') === 1200000, parseStatNumber('1,2 triệu'));
check('A05', '856K = 856000', parseStatNumber('856K') === 856000, parseStatNumber('856K'));
check('A06', '1,234 (nghìn) = 1234', parseStatNumber('1,234') === 1234, parseStatNumber('1,234'));
check('A07', '10,800 = 10800', parseStatNumber('10,800') === 10800, parseStatNumber('10,800'));
check('A08', '655 = 655', parseStatNumber('655') === 655, parseStatNumber('655'));
check('A09', 'formatCompact 10800 = 10,8K', formatCompact(10800) === '10,8K', formatCompact(10800));
check('A10', 'formatCompact 1400 = 1,4K, 888 = 888, 1M', formatCompact(1400) === '1,4K' && formatCompact(888) === '888' && formatCompact(1000000) === '1M', [formatCompact(1400), formatCompact(888), formatCompact(1000000)]);

// B: giờ tương đối (8 ca)
const NOW = Date.parse('2026-10-31T12:00:00.000Z');
check('B01', 'ISO 2 ngày trước', formatTimeLabel('2026-10-29T12:00:00.000Z', NOW) === '2 ngày', formatTimeLabel('2026-10-29T12:00:00.000Z', NOW));
check('B02', 'ISO 20 giờ trước', formatTimeLabel('2026-10-30T16:00:00.000Z', NOW) === '20 giờ', formatTimeLabel('2026-10-30T16:00:00.000Z', NOW));
check('B03', 'ISO 5 phút trước', formatTimeLabel('2026-10-31T11:55:00.000Z', NOW) === '5 phút', formatTimeLabel('2026-10-31T11:55:00.000Z', NOW));
check('B04', 'không bao giờ hiện ISO', !formatTimeLabel('2026-10-30T14:02:55.000Z', NOW).includes('2026'), formatTimeLabel('2026-10-30T14:02:55.000Z', NOW));
check('B05', 'giữ nguyên "20 giờ"', formatTimeLabel('20 giờ', NOW) === '20 giờ', formatTimeLabel('20 giờ', NOW));
check('B06', 'giữ nguyên "2 ngày"', formatTimeLabel('2 ngày', NOW) === '2 ngày', formatTimeLabel('2 ngày', NOW));
check('B07', 'rỗng -> rỗng', formatTimeLabel('', NOW) === '', formatTimeLabel('', NOW));
check('B08', 'vừa xong < 1 phút', formatTimeLabel('2026-10-31T11:59:40.000Z', NOW) === 'Vừa xong', formatTimeLabel('2026-10-31T11:59:40.000Z', NOW));

// C: lọc rác (10 ca)
check('C01', '"856K lượt xem" là rác', isJunkText('856K lượt xem', 'u', 'U'), 'not junk');
check('C02', '"20 giờ" là rác', isJunkText('20 giờ', 'u', 'U'), 'not junk');
check('C03', '"Tác giả" là rác', isJunkText('Tác giả', 'u', 'U'), 'not junk');
check('C04', '"19 giờ" là rác', isJunkText('19 giờ', 'u', 'U'), 'not junk');
check('C05', '"Dịch" là rác', isJunkText('Dịch', 'u', 'U'), 'not junk');
check('C06', '"655" là rác', isJunkText('655', 'u', 'U'), 'not junk');
check('C07', 'nội dung thật không phải rác', !isJunkText('Con gái không nên đóng ý những mối bố mẹ', 'u', 'U'), 'junk');
check('C08', 'bình luận ngắn "Ừ" không phải rác', !isJunkText('Ừ 😅', 'u', 'U'), 'junk');
check('C09', 'tên user là rác', isJunkText('star1rfff', 'star1rfff', 'Star'), 'not junk');
check('C10', '"1,2 triệu lượt xem" là rác', isJunkText('1,2 triệu lượt xem', 'u', 'U'), 'not junk');

// D: fixture lồng nhau (8 ca)
const d = extractPosts(load('thread-nested.html'));
check('D01', 'đủ 5 bài, đúng thứ tự trang', eq(d.map((p) => p.id), ['AAA111', 'BBB222', 'CCC333', 'DDD444', 'EEE555']), d.map((p) => p.id));
check('D02', 'bài gốc không lẫn lượt xem/Tác giả', !d[0].content.includes('lượt xem') && !d[0].content.includes('Tác giả') && d[0].content.includes('Con gái'), d[0].content);
check('D03', 'bài gốc đủ 2 đoạn, không lẫn reply', d[0].content.includes('Sau đầu họ') && !d[0].content.includes('nhất gái'), d[0].content);
check('D04', 'like bài gốc 10800 (10,8K)', d[0].stats.likes === 10800 && d[0].stats.shares === 1400, d[0].stats);
check('D05', 'reply không lẫn "20 giờ"', !d[2].content.includes('20 giờ') && d[2].content.includes('hiểu lầm'), d[2].content);
check('D06', 'parent/depth của reply lồng nhau', d[2].parentId === 'BBB222' && d[2].depth === 1 && d[3].parentId === 'BBB222', d.map((p) => [p.id, p.parentId, p.depth]));
check('D07', 'group: chuỗi panther có 2 reply', (() => { const g = groupIntoChains(d); return g.chains.length === 2 && g.chains[0].replies.length === 2 && g.chains[1].root.id === 'EEE555'; })(), groupIntoChains(d).chains.map((c) => [c.root.id, c.replies.map((r) => r.id)]));
check('D08', 'timeLabel không phải ISO', d.every((p) => !p.timeLabel.includes('2026')), d.map((p) => p.timeLabel));

// E: fixture phẳng + quoted (7 ca)
const e = extractPosts(load('thread-flat-quoted.html'));
check('E01', 'đủ 3 bài phẳng', eq(e.map((p) => p.id), ['FFF666', 'GGG777', 'HHH888']), e.map((p) => p.id));
check('E02', 'không lấy nội dung quoted', !e[0].content.includes('trích dẫn') && e[0].content.includes('Vì tiếc 100k'), e[0].content);
check('E03', 'không lấy "Dịch"', !e[0].content.includes('Dịch'), e[0].content);
check('E04', 'like 1,2 triệu qua svg aria', e[0].stats.likes === 1200000, e[0].stats);
check('E05', 'displayName khác username', e[0].author.displayName === 'Phương' && e[0].author.username === '_tf.thphng28_', e[0].author);
check('E06', 'không trùng lặp span con', e[2].content === 'Chữ trong span con, không được trùng lặp.', e[2].content);
check('E07', 'phẳng: không có parent giả', e.every((p) => p.parentId === null && p.depth === 0), e.map((p) => [p.id, p.parentId]));

// F: fixture biên (7 ca)
const f = extractPosts(load('thread-edge.html'));
check('F01', 'bỏ bài trống, còn 3 bài', eq(f.map((p) => p.id), ['MAIN01', 'SHORT03', 'VERIF04']), f.map((p) => p.id));
check('F02', 'link trùng không tạo 2 bài', f.filter((p) => p.id === 'MAIN01').length === 1, f.length);
check('F03', 'bình luận ngắn giữ lại', f.some((p) => p.id === 'SHORT03' && p.content.includes('Ừ')), f.map((p) => p.content));
check('F04', 'verified nhận diện được', f.find((p) => p.id === 'VERIF04')?.author.isVerified === true, f.map((p) => p.author.isVerified));
check('F05', '"10,800" = 10800, "1,000" = 1000', (() => { const v = f.find((p) => p.id === 'VERIF04'); return v.stats.likes === 10800 && v.stats.replies === 1000; })(), f.find((p) => p.id === 'VERIF04')?.stats);
check('F06', 'avatarUrl lấy được', f.every((p) => (p.author.avatarUrl || '').includes('cdn.example')), f.map((p) => p.author.avatarUrl));
check('F07', 'group edge: 2 chuỗi độc lập', groupIntoChains(f).chains.length === 2, groupIntoChains(f).chains.length);

// G: fixture DOM mới <article>, không dir="auto", link rút gọn (5 ca)
const g = extractPosts(load('thread-article.html'));
check('G01', 'đủ 4 bài, đúng thứ tự trang', eq(g.map((p) => p.id), ['ART001', 'REP002', 'REP003', 'ONLY99']), g.map((p) => p.id));
check('G02', 'bài gốc lấy được chữ từ span thường, không lẫn lượt xem', g[0].content === 'vì tiếc 100k mà t phải như này' && g[0].stats.likes === 43300, [g[0].content, g[0].stats]);
check('G03', 'reply lồng 2 tầng: REP003 cha là REP002, sâu 1; bài gốc không lẫn reply', g[2].parentId === 'REP002' && g[2].depth === 1 && !g[0].content.includes('Trả lời lồng') && g[1].content === 'Trả lời lồng trong khung cha.', g.map((p) => [p.id, p.parentId, p.depth, p.content]));
check('G04', 'link /post/<id> suy username từ link hồ sơ, lấy chữ từ <p>', (() => { const o = g.find((p) => p.id === 'ONLY99'); return o.author.username === 'solo_user' && o.content === 'Nội dung trong thẻ p, link rút gọn.'; })(), g.find((p) => p.id === 'ONLY99')?.author);
check('G05', 'group article: 2 chuỗi, REP003 gắn đúng chuỗi REP002', (() => { const gr = groupIntoChains(g); return gr.chains.length === 2 && gr.chains[0].root.id === 'REP002' && gr.chains[0].replies.length === 1 && gr.chains[0].replies[0].id === 'REP003'; })(), groupIntoChains(g).chains.map((c) => [c.root.id, c.replies.map((r) => r.id)]));

console.log(`\n${pass}/${pass + fail} ca PASS (${cases.filter((c) => c.ok).length} ok, ${fail} fail)`);
process.exit(fail ? 1 : 0);
