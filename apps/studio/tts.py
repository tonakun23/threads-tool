#!/usr/bin/env python3
"""Giọng đọc AI cho Studio.

Dùng Microsoft Edge TTS (miễn phí, không cần API key) qua gói edge-tts.
Nếu edge-tts không chạy được (mất mạng / bị chặn), thoát mã 2 để
render.py tự chuyển sang chế độ im lặng ước lượng thời lượng — video
vẫn dựng được, chỉ thiếu giọng đọc thật.
"""
from __future__ import annotations

import argparse
import asyncio
import sys


async def _speak(text: str, voice: str, rate: str, out: str) -> None:
    import edge_tts  # noqa: PLC0415

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--voice", default="vi-VN-HoaiMyNeural")
    ap.add_argument("--rate-percent", type=int, default=20)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rate = f"{args.rate_percent:+d}%"
    try:
        asyncio.run(_speak(args.text, args.voice, rate, args.out))
    except Exception as exc:  # noqa: BLE001 - mọi lỗi đều là fallback
        print(f"TTS failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
