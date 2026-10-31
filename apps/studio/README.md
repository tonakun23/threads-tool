# Threads Comment Studio

Web app dựng **video đọc bình luận Threads 9:16 (1080×1920)** từ link bài gốc,
theo đúng mẫu trong ảnh Tony gửi: thẻ bình luận hiển thị giữa màn hình, giọng
đọc AI đọc từng bình luận, chèn meme, watermark chống re-up, video nền, nhạc nền.

Phần cào giữ nguyên chiến lược của toolkit gốc (`src/utils/parser.ts`):
tìm link `/post/`, đi ngược lên container có nút thống kê, đọc text trong
`div[dir="auto"]`. Phần Studio là code mới, không sửa `src/` của toolkit.

## Chạy

Cần có trước: Node.js, Python 3 và FFmpeg trong PATH (kiểm tra: `node --version`, `python --version`, `ffmpeg -version`). Chưa có FFmpeg trên Windows thì cài bằng `winget install Gyan.FFmpeg` rồi mở lại PowerShell.

### Linux / macOS

```bash
cd apps/studio
# Bắt buộc: Python 3 + Pillow + FFmpeg hệ thống
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# Giọng đọc AI (Edge TTS, miễn phí, không cần key) nằm trong requirements.txt.
# Nếu chỉ test render không cần giọng thật, bỏ qua bước venv cũng được:
# render sẽ tự dùng file im lặng ước lượng thời lượng.

# Cào live cần thêm Playwright (nặng, chỉ cài khi cần):
# Playwright cũng dùng để chụp thẻ embed chính thức (mặc định) lúc render.
npm install playwright && npx playwright install chromium

node server.js
# Mở http://localhost:3100
```

### Windows (PowerShell) — chạy từng lệnh một, không dùng `&&`

PowerShell cũ không hiểu `&&`, lệnh trên Windows là `python` (không phải
`python3`), đường dẫn venv là `.venv\Scripts\`. Quan trọng: phải `cd`
vào đúng thư mục `apps\studio` thì `node server.js` mới tìm thấy file.

```powershell
cd C:\Users\nguye\Downloads\threads-toolkit-video\apps\studio
python --version
node --version
ffmpeg -version
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
node server.js
# Mở http://localhost:3100
```

Không cần kích hoạt venv (`Activate.ps1` hay bị chặn bởi Execution Policy):
dùng thẳng `.\.venv\Scripts\python.exe` như trên là đủ, vì render tự tìm
python trong `.venv`. Muốn cào live thì thêm, cũng từng lệnh một:

```powershell
npm install playwright
npx playwright install chromium
```

## Luồng dùng

1. **Cào link:** dán link `threads.com/@.../post/...` hoặc `threads.com/share/...`,
   chọn số bình luận → Studio lấy bài gốc + bình luận nhiều tương tác nhất.
   Không cào live được (login wall / chưa cài Playwright) thì dùng
   **Dữ liệu demo** hoặc **Dán JSON dataset** của toolkit gốc / Apify.
2. **Kịch bản:** mỗi đoạn có 2 ô — *chữ hiển thị trên thẻ* và *chữ đọc TTS*.
   Giữ nguyên câu chữ thì để 2 ô giống nhau. Chọn meme cho từng đoạn,
   thêm/xoá/sắp xếp lại đoạn. Panel **Xem trước** bên phải hiện ngay khung
   9:16 như video xuất ra (thẻ, watermark, nền, meme), bấm nút “👁 Xem” ở
   từng đoạn hoặc “Phát thử” để chạy qua các đoạn theo thời lượng ước lượng.
3. **Xuất video:** chọn giọng (Hoài My / Nam Minh), tốc độ đọc, watermark +
   vị trí, video nền (mp4, tự lặp), ảnh nền, nhạc nền + âm lượng → **Xuất Video**.
   Video ra ở `out/threads-comments-*.mp4`, xem trước và tải ngay trên web.

## Giọng đọc AI

Edge TTS (`edge-tts`, giọng `vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`),
miễn phí, không cần API key, nhưng cần mạng tới `speech.platform.bing.com`
trên máy chạy render. Nếu TTS không tới được (máy chủ chặn), render vẫn
xong nhưng đoạn đó sẽ im lặng với thời lượng ước lượng theo độ dài chữ —
log sẽ ghi rõ. Muốn giọng khác (OpenAI / ElevenLabs…), thay `tts.py`.

## File & API

| File | Việc |
|---|---|
| `server.js` | Web server Node thuần (không dependency), API + upload + job render |
| `scraper.js` | Cào live bằng Playwright, in JSON `{post, comments}` |
| `card-shot.js` | Dựng lại thẻ giống giao diện Threads bản tối (HTML/CSS → ảnh PNG bằng Playwright): avatar thật, tên + giờ, nội dung, hàng số liệu, reply thụt vào có kẻ dọc. Không phụ thuộc embed.js hay trang Threads. Nút “📷 Xem thẻ thật” gọi `/api/card-shots`. Dựng lỗi thì đoạn đó tự rơi về thẻ vẽ tay. |
| `embed-shot.js` | Chụp thẻ Threads chính thức từ mã embed (`Get embed code`): dựng blockquote `text-post-media` + `embed.js`, chụp bằng Playwright. Cần Playwright + Chromium (chung với cào live). Chụp lỗi thì đoạn đó tự rơi về thẻ vẽ tay. Nút “📷 Xem thẻ thật” ở chế độ Embed gọi `/api/embed-shots` để chụp và hiện đúng thẻ trong khung xem trước (lưu cache theo postId trong `embed-preview/`). |
| `render.py` | Vẽ thẻ PNG (Pillow) + dựng clip từng đoạn + nối + trộn BGM (FFmpeg). Nếu `cardStyle=replica` và có ảnh `cardPng` thì dùng thẳng ảnh thẻ replica; nếu `cardStyle=embed` và đủ ảnh embed thì xếp chồng ảnh embed thành thẻ; còn lại vẽ tay. |
| `tts.py` | Gọi Edge TTS, lỗi thì trả mã 2 để render fallback |
| `demo-data.json` | Bài + 7 bình luận mẫu theo ảnh chụp Tony gửi |
| `public/` | Giao diện web tiếng Việt |

API: `POST /api/scrape` (`live|demo|paste`), `POST /api/upload`,
`POST /api/render`, `GET /api/jobs/:id`, `GET /api/voices`, `GET /api/demo`.

## Giới hạn (nói thẳng)

- Chỉ dữ liệu **công khai**; tài khoản private / nội dung đã xoá không lấy được.
- Threads giới hạn lượng nội dung tải được và có thể hiện login wall.
- Tốc độ render phụ thuộc FFmpeg trên máy; mỗi đoạn render riêng rồi nối.
- Dùng có trách nhiệm, tôn trọng điều khoản Threads và quyền của người đăng.
  Watermark trong app là watermark của *người làm video* (chống re-up),
  không phải watermark của Threads.
