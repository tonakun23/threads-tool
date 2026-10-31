#!/usr/bin/env python3
"""Dựng video đọc bình luận Threads 9:16 (1080x1920) bằng FFmpeg + Pillow.

Mỗi đoạn (segment) = 1 thẻ bình luận/bài gốc hiển thị giữa màn hình,
trên nền video/ảnh nền, có watermark chống re-up, meme chèn góc dưới,
giọng đọc AI đọc riêng phần `ttsText`, nhạc nền trộn nhỏ dưới giọng đọc.

Luồng: thẻ PNG (Pillow) -> clip từng đoạn (FFmpeg) -> nối các đoạn
-> trộn BGM -> file MP4 cuối. Không cần GPU.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Windows mặc định stdout/stderr là cp1252 khi bị pipe: mọi print() có
# tiếng Việt (thử, ước lượng, nội dung bình luận...) đều crash với
# UnicodeEncodeError 'charmap'. Ép UTF-8 ngay từ đầu, khỏi phụ thuộc
# locale của máy chạy. Server cũng ép thêm qua PYTHONUTF8/PYTHONIOENCODING.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001, S110 - stream đã đóng / không hỗ trợ
        pass

HERE = Path(__file__).resolve().parent
W, H, FPS = 1080, 1920, 30
CARD_W = 980
def _find_font(bold: bool) -> str | None:
    """Tìm font hệ thống, chạy được cả Linux, Windows, macOS."""
    windir = os.environ.get("SystemRoot") or r"C:\Windows"
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        str(Path(windir) / "Fonts" / ("arialbd.ttf" if bold else "arial.ttf")),
        str(Path(windir) / "Fonts" / ("segoeuib.ttf" if bold else "segoeui.ttf")),
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


FONT_BOLD = _find_font(bold=True)
FONT_REG = _find_font(bold=False)


def font(path: str | None, size: int) -> ImageFont.FreeTypeFont:
    if path:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def make_watermark_png(text: str, out: Path) -> None:
    """Vẽ watermark thành ảnh PNG (Pillow) rồi overlay bằng FFmpeg.

    Tránh FFmpeg drawtext: đường dẫn font Windows (C:\\...) và ký tự
    tiếng Việt hay làm drawtext lỗi escape trên Windows.
    """
    fnt = font(FONT_BOLD, 34)
    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    tw = int(d.textlength(text, font=fnt)) + 32
    img = Image.new("RGBA", (tw, 62), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, tw - 1, 61], radius=12, fill=(0, 0, 0, 115))
    d.text((16, 13), text, font=fnt, fill=(255, 255, 255, 255))
    img.save(out, "PNG")


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    r = subprocess.run(cmd, cwd=str(cwd) if cwd else None,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout[-4000:], file=sys.stderr)
        raise RuntimeError(f"ffmpeg/python failed ({r.returncode}): {cmd[0]}")


def ffprobe_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def estimate_duration(text: str, rate_percent: int) -> float:
    # Tiếng Việt đọc ~12 ký tự/giây ở tốc độ chuẩn; +20% thì nhanh hơn.
    speed = 12.0 * (100 + rate_percent) / 100.0
    return max(1.5, min(30.0, len(text) / max(speed, 1.0) + 0.4))


def avatar_color(username: str) -> tuple[int, int, int]:
    h = int(hashlib.md5(username.encode()).hexdigest()[:6], 16)
    palette = [(37, 99, 235), (220, 38, 38), (5, 150, 105), (217, 119, 6),
               (124, 58, 237), (219, 39, 119), (2, 132, 199)]
    return palette[h % len(palette)]


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        words = para.split()
        if not words:
            lines.append("")
            continue
        cur = words[0]
        for word in words[1:]:
            trial = f"{cur} {word}"
            if draw.textlength(trial, font=fnt) <= max_w:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


def format_compact(n: int) -> str:
    """10800 -> '10,8K' (kiểu Việt Nam, giống số hiển thị trên Threads)."""
    v = int(n or 0)
    if v >= 1_000_000:
        s = f"{v / 1_000_000:.1f}".replace('.', ',')
        return (s[:-2] if s.endswith(',0') else s) + 'M'
    if v >= 1000:
        s = f"{v / 1000:.1f}".replace('.', ',')
        return (s[:-2] if s.endswith(',0') else s) + 'K'
    return str(v)


def avatar_letter(username: str) -> str:
    for ch in username or '':
        if ch.isalnum():
            return ch.upper()
    return '?'


def render_card(seg: dict, out: Path) -> None:
    """Thẻ tối giống Threads dark mode trong video mẫu: nền #141414,
    chữ trắng, giờ xám, mỗi bình luận một hàng thống kê rút gọn.
    Chuỗi trả lời (items) hiện chung một thẻ, reply thụt vào + kẻ dọc.
    """
    raw_items = seg.get("items") or [seg]
    items = []
    for it in raw_items:
        author = it.get("author") or {}
        items.append({
            "username": author.get("username") or "unknown",
            "display": author.get("displayName") or author.get("username") or "unknown",
            "is_verified": bool(author.get("isVerified")),
            "content": it.get("content") or "",
            "stats": it.get("stats") or {},
            "time_label": it.get("timeLabel") or it.get("timestamp") or "",
            "depth": int(it.get("depth") or 0),
        })
    # Reply sau bình luận đầu được thụt vào dù depth từ dữ liệu cũ = 0.
    for i in range(1, len(items)):
        items[i]["depth"] = max(1, items[i]["depth"])

    pad, gap = 44, 20
    inner_w = CARD_W - pad * 2
    MAX_H = 1480
    body_size = 40
    while True:
        tmp = Image.new("RGB", (CARD_W, 10))
        d = ImageDraw.Draw(tmp)
        total_h = pad
        blocks = []
        for idx, it in enumerate(items):
            indent = 58 if it["depth"] else 0
            w = inner_w - indent
            lines = wrap(d, it["content"], font(FONT_REG, body_size), w)
            stats_h = 40
            header_h = 64 if not it["depth"] else 56
            h = header_h + 14 + len(lines) * (body_size + 12) + gap + stats_h
            blocks.append((lines, h, header_h))
            total_h += h + (16 if idx else 0)
        total_h += pad - 16
        if total_h <= MAX_H or body_size <= 28:
            break
        body_size -= 4
    card_h = min(total_h, MAX_H)

    img = Image.new("RGBA", (CARD_W, card_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, CARD_W - 1, card_h - 1], radius=28,
                        fill=(20, 20, 20, 255), outline=(64, 64, 64, 255), width=2)
    # Logo Threads góc phải trên: vòng tròn + @.
    d.ellipse([CARD_W - 92, pad - 8, CARD_W - 44, pad + 40], outline=(212, 212, 212, 255), width=3)
    lf = font(FONT_BOLD, 28)
    d.text((CARD_W - 80, pad + 2), "@", font=lf, fill=(255, 255, 255, 255))
    y = pad
    for idx, it in enumerate(items):
        indent = 58 if it["depth"] else 0
        x0 = pad + indent
        if it["depth"]:
            d.line([(pad + 28, y + 8), (pad + 28, y + blocks[idx][1] - 16)],
                   fill=(96, 96, 96, 255), width=3)
        r = 40 if not it["depth"] else 32
        cx, cy = x0 + r, y + r
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=avatar_color(it["username"]))
        letter = avatar_letter(it["username"])
        lfont = font(FONT_BOLD, 38 if not it["depth"] else 30)
        tw = d.textlength(letter, font=lfont)
        d.text((cx - tw / 2, cy - (26 if not it["depth"] else 21)), letter, font=lfont,
               fill=(255, 255, 255, 255))
        name_x = x0 + r * 2 + 16
        name_font = font(FONT_BOLD, 36 if not it["depth"] else 32)
        d.text((name_x, y + 2), it["username"], font=name_font, fill=(255, 255, 255, 255))
        if it["is_verified"]:
            nx = name_x + d.textlength(it["username"], font=name_font) + 8
            d.text((nx, y + 2), "✓", font=font(FONT_BOLD, 28), fill=(37, 99, 235, 255))
        if it["time_label"]:
            tx = name_x + d.textlength(it["username"], font=name_font) + (28 if it["is_verified"] else 12)
            d.text((tx, y + 8), str(it["time_label"]), font=font(FONT_REG, 28),
                   fill=(163, 163, 163, 255))
        # Nội dung.
        cy_text = y + blocks[idx][2] + 14
        bf = font(FONT_REG, body_size)
        for line in blocks[idx][0]:
            if cy_text + body_size > card_h - pad - 40:
                break
            d.text((x0, cy_text), line, font=bf, fill=(255, 255, 255, 255))
            cy_text += body_size + 12
        # Thống kê rút gọn: ♥ like · ✉ reply · ⇄ repost · ↗ share.
        stats = it["stats"]
        stats_text = (f"♥ {format_compact(stats.get('likes', 0))}    "
                      f"✉ {format_compact(stats.get('replies', 0))}    "
                      f"⇄ {format_compact(stats.get('reposts', 0))}    "
                      f"↗ {format_compact(stats.get('shares', 0))}")
        d.text((x0, cy_text + 4), stats_text, font=font(FONT_REG, 29),
               fill=(212, 212, 212, 255))
        y += blocks[idx][1] + 16
        if y > card_h - pad:
            break
    img.save(out, "PNG")


def gradient_bg(out: Path) -> None:
    img = Image.new("RGB", (W, H))
    top, bottom = (15, 23, 42), (76, 29, 149)
    for y in range(H):
        t = y / H
        img.paste(tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
                  (0, y, W, y + 1))
    d = ImageDraw.Draw(img, "RGBA")
    for cx, cy, r, a in [(200, 300, 320, 40), (900, 800, 380, 36), (300, 1500, 300, 30)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, a))
    img.save(out, "PNG")


def make_tts(seg: dict, settings: dict, out: Path, work: Path) -> float:
    items = seg.get("items") or [seg]
    parts = []
    for it in items:
        t = (it.get("ttsText") or it.get("content") or "").strip()
        if t:
            parts.append(t if t[-1] in '.!?…' else t + '.')
    text = " ".join(parts).strip()
    voice = settings.get("voice", "vi-VN-HoaiMyNeural")
    rate = int(settings.get("ratePercent", 20))
    if not text:
        text = "(không có nội dung đọc)"
    # Thử python của .venv trong studio TRƯỚC (nơi đã cài edge-tts),
    # rồi mới tới python đang chạy render.py. Ghi rõ từng lần thử để
    # biết lỗi là "chưa cài edge-tts" hay "không nối được Edge TTS".
    # Windows: .venv\Scripts\python.exe ; Linux/macOS: .venv/bin/python
    candidates = []
    venv_py = (HERE / ".venv" / "Scripts" / "python.exe") if os.name == "nt" \
        else (HERE / ".venv" / "bin" / "python")
    if venv_py.exists():
        candidates.append(str(venv_py))
    if sys.executable not in candidates:
        candidates.append(sys.executable)
    for py in candidates:
        r = subprocess.run(
            [str(py), str(HERE / "tts.py"), "--text", text, "--voice", voice,
             "--rate-percent", str(rate), "--out", str(out)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace",
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8:replace"})
        if r.returncode == 0 and out.exists() and out.stat().st_size > 1000:
            dur = ffprobe_duration(out)
            if dur > 0:
                print(f"TTS ok ({voice}, {dur:.1f}s): {text[:40]}", flush=True)
                return dur
        tail = (r.stdout or "").strip().split("\n")[-1][:200]
        print(f"TTS fallback ({py}, exit {r.returncode}): {tail}", flush=True)
    # Fallback: file im lặng, thời lượng ước lượng theo độ dài chữ.
    dur = estimate_duration(text, rate)
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
         "-t", f"{dur:.2f}", "-c:a", "libmp3lame", "-q:a", "4", str(out)])
    print(f"TTS không khả dụng, dùng im lặng {dur:.1f}s (cần mạng tới Edge TTS trên máy chạy).",
          flush=True)
    return dur


def render_segment(i: int, seg: dict, settings: dict, work: Path,
                   bg_png: Path, dur: float) -> Path:
    card = work / f"card-{i}.png"
    render_card(seg, card)
    narration = work / f"narr-{i}.mp3"
    tts_dur = make_tts(seg, settings, narration, work)
    total = tts_dur + float(settings.get("pauseSeconds", 0.6))

    bg_video = settings.get("bgVideo") or None
    bg_image = settings.get("bgImage") or None
    seg_out = work / f"seg-{i}.mp4"
    cmd: list[str] = ["ffmpeg", "-y"]
    # Input 0: nền (video lặp / ảnh lặp / nền gradient).
    if bg_video:
        offset = (i * 7) % 30
        cmd += ["-ss", str(offset), "-stream_loop", "-1", "-t", f"{total:.2f}", "-i", bg_video]
    elif bg_image:
        cmd += ["-loop", "1", "-t", f"{total:.2f}", "-i", bg_image]
    else:
        cmd += ["-loop", "1", "-t", f"{total:.2f}", "-i", str(bg_png)]
    cmd += ["-loop", "1", "-t", f"{total:.2f}", "-i", str(card),
            "-i", str(narration)]
    meme = seg.get("meme") or {}
    meme_path = meme.get("path") if isinstance(meme, dict) else None
    meme_kind = meme.get("kind") if isinstance(meme, dict) else None
    has_meme = bool(meme_path and Path(meme_path).exists())
    if has_meme:
        if meme_kind == "video":
            cmd += ["-stream_loop", "-1", "-t", f"{total:.2f}", "-i", meme_path]
        else:
            cmd += ["-loop", "1", "-t", f"{total:.2f}", "-i", meme_path]
    watermark = (settings.get("watermark") or "").strip()
    wm_idx = 4 if has_meme else 3
    if watermark:
        wm_png = work / "watermark.png"
        make_watermark_png(watermark, wm_png)
        cmd += ["-loop", "1", "-t", f"{total:.2f}", "-i", str(wm_png)]

    filt = ("[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,setsar=1,fps=30,format=yuv420p,"
            "eq=brightness=-0.06:saturation=1.05[bg];"
            "[bg][1:v]overlay=(W-w)/2:(H-h)/2:shortest=1[ov]")
    last = "ov"
    if has_meme:
        filt += (";[3:v]scale=300:-1:force_original_aspect_ratio=decrease[mm];"
                 f"[{last}][mm]overlay=W-w-36:H-360[ovm]")
        last = "ovm"
    # Watermark: ảnh PNG overlay, khỏi dùng drawtext (lỗi font/escape trên Windows).
    if watermark:
        pos = settings.get("watermarkPosition", "top")
        y_top, y_bottom = "56", "H-h-56"
        if pos == "bottom":
            filt += f";[{last}][{wm_idx}:v]overlay=(W-w)/2:{y_bottom}[vout]"
        elif pos == "both":
            filt += (f";[{last}][{wm_idx}:v]overlay=(W-w)/2:{y_top}[wm];"
                     f"[wm][{wm_idx}:v]overlay=(W-w)/2:{y_bottom}[vout]")
        else:  # top
            filt += f";[{last}][{wm_idx}:v]overlay=(W-w)/2:{y_top}[vout]"
    else:
        filt += f";[{last}]null[vout]"
    cmd += ["-filter_complex", filt, "-map", "[vout]", "-map", "2:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k",
            "-t", f"{total:.2f}", str(seg_out)]
    run(cmd)
    print(f"SEGMENT {i + 1} done ({total:.1f}s)", flush=True)
    return seg_out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workdir", default=None)
    args = ap.parse_args()
    project = json.loads(Path(args.project).read_text(encoding="utf-8"))
    segments: list[dict] = project.get("segments") or []
    if not segments:
        print("project không có segment nào", file=sys.stderr)
        return 1
    settings: dict = project.get("settings") or {}
    out = Path(args.out)
    work = Path(args.workdir) if args.workdir else out.parent / (out.stem + ".work")
    work.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)

    bg_png = work / "gradient.png"
    if not (settings.get("bgVideo") or settings.get("bgImage")):
        gradient_bg(bg_png)

    seg_files = []
    for i, seg in enumerate(segments):
        first_author = (seg.get("items") or [seg])[0].get("author", {}).get("username")
        print(f"SEGMENT {i + 1}/{len(segments)}: @{first_author}"
              + (f" +{len(seg['items']) - 1} trả lời" if seg.get("items") else ""),
              flush=True)
        seg_files.append(render_segment(i, seg, settings, work, bg_png, 0))
    # Nối các đoạn.
    concat_txt = work / "concat.txt"
    concat_txt.write_text("".join(f"file '{f}'\n" for f in seg_files), encoding="utf-8")
    concat_mp4 = work / "concat.mp4"
    r = subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i",
                        str(concat_txt), "-c", "copy", str(concat_mp4)],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0 or not concat_mp4.exists():
        print("concat -c copy thất bại, nối lại bằng re-encode", flush=True)
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
             "-pix_fmt", "yuv420p", "-c:a", "aac", str(concat_mp4)])
    total_dur = ffprobe_duration(concat_mp4)

    bgm = settings.get("bgm") or None
    if bgm and Path(bgm).exists():
        vol = float(settings.get("bgmVolume", 0.12))
        run(["ffmpeg", "-y", "-i", str(concat_mp4), "-stream_loop", "-1", "-i", bgm,
             "-filter_complex",
             f"[1:a]volume={vol},apad,atrim=0:{total_dur:.2f}[bgm];"
             "[0:a][bgm]amix=inputs=2:duration=first:normalize=0[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac",
             "-b:a", "192k", "-shortest", str(out)])
    else:
        run(["ffmpeg", "-y", "-i", str(concat_mp4), "-c", "copy", str(out)])
    print(f"DONE {out} ({total_dur:.1f}s, {len(segments)} đoạn)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
