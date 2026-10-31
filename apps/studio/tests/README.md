# Test trích xuất Threads (chỉ chạy local, không commit node_modules)

`threads-parse.js` là logic thuần DOM, dùng chung cho scraper (Playwright)
và test (jsdom). Fixtures trong `fixtures/` mô phỏng DOM trang Threads
(lồng nhau / phẳng / quoted / biên) theo video mẫu Tony gửi 31/10.

Chạy (từ thư mục tạm, jsdom không nằm trong repo):

```
mkdir -p /tmp/threads-tests/work
cp -r tests /tmp/threads-tests/work/tests
cp ../threads-parse.js /tmp/threads-tests/work/threads-parse.js
cd /tmp/threads-tests
npm init -y
npm install jsdom
cd work
ln -s /tmp/threads-tests/node_modules node_modules
node tests/run-parse-tests.mjs
```

Kỳ vọng: `50/50 ca PASS`. Runner thoát 1 nếu có ca fail.
