#!/usr/bin/env python3
"""Giọng đọc AI cho Studio.

Thử lần lượt 3 đường, đường nào ra tiếng thì dùng đường đó:
1. Edge TTS qua máy chủ cũ (speech.platform.bing.com).
2. Edge TTS qua máy chủ mới (api.msedgeservices.com) — Microsoft đã
   chuyển Read Aloud sang máy chủ này từ 10/2026; máy chủ cũ trả 403
   hoặc "No audio was received" ở nhiều khu vực (edge-tts #490).
   Chỉ đổi URL websocket lúc chạy, không sửa gói edge-tts.
3. gTTS (Google Translate TTS, tiếng Việt) — cần `pip install gtts`,
   giọng Google, khác Hoài My/Nam Minh nhưng vẫn là tiếng Việt.

In "TTS engine: <token>" ra stdout khi thành công để render.py và
server biết giọng đọc tới từ đâu. Mọi đường đều lỗi thì thoát mã 2
để render.py chuyển sang chế độ im lặng ước lượng thời lượng.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib
import os
import sys

# Máy chủ TTS mới của Microsoft Edge (Read Aloud v2).
NEW_WSS_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
EDGE_TIMEOUT = 30


def _patch_wss_url(url: str) -> None:
    """Đổi URL websocket của edge-tts lúc chạy.

    edge-tts đọc URL khi kết nối, nên gán lại hằng WSS_URL ở cả hai
    module (constants và communicate) trước khi tạo Communicate mới.
    Gán lỗi thì bỏ qua — lượt đó sẽ chạy như bình thường.
    """
    for mod_name in ("edge_tts.constants", "edge_tts.communicate"):
        try:
            mod = importlib.import_module(mod_name)
            if hasattr(mod, "WSS_URL"):
                setattr(mod, "WSS_URL", url)
        except Exception:  # noqa: BLE001, S110
            pass


async def _speak_edge(text: str, voice: str, rate: str, out: str, wss_url: str | None) -> None:
    import edge_tts  # noqa: PLC0415

    if wss_url:
        _patch_wss_url(wss_url)
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(out)


def _speak_gtts(text: str, out: str) -> None:
    from gtts import gTTS  # noqa: PLC0415

    gTTS(text=text, lang="vi").save(out)


async def _attempt(coro) -> str | None:
    """Chạy một lượt Edge, trả None nếu xong, ngược lại trả lý do lỗi."""
    try:
        await asyncio.wait_for(coro, timeout=EDGE_TIMEOUT)
        return None
    except TimeoutError:
        return f"timeout sau {EDGE_TIMEOUT} giây"
    except Exception as exc:  # noqa: BLE001
        return str(exc) or exc.__class__.__name__


def _edge_version() -> str:
    try:
        from importlib.metadata import version  # noqa: PLC0415

        return version("edge-tts")
    except Exception:  # noqa: BLE001
        return "?"


def _install_hint() -> str:
    if os.name == "nt":
        return r"cài bằng: .\.venv\Scripts\python.exe -m pip install gtts (chạy trong thư mục apps\studio)"
    return "cài bằng: python3 -m pip install gtts"


def main() -> int:
    # Như render.py: Windows pipe mặc định cp1252, in lỗi có tiếng Việt sẽ
    # crash UnicodeEncodeError. Ép UTF-8 trước khi làm gì khác.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001, S110
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--voice", default="vi-VN-HoaiMyNeural")
    ap.add_argument("--rate-percent", type=int, default=20)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rate = f"{args.rate_percent:+d}%"

    # Lượt 1: Edge TTS, máy chủ cũ.
    err = asyncio.run(_attempt(_speak_edge(args.text, args.voice, rate, args.out, None)))
    if err is None:
        print("TTS engine: edge-tts")
        return 0
    errors = [f"Edge máy chủ cũ: {err} (edge-tts {_edge_version()})"]

    # Lượt 2: Edge TTS, máy chủ mới.
    err = asyncio.run(_attempt(_speak_edge(args.text, args.voice, rate, args.out, NEW_WSS_URL)))
    if err is None:
        print("TTS engine: edge-tts-new")
        return 0
    errors.append(f"Edge máy chủ mới: {err}")

    # Lượt 3: gTTS (giọng Google, vẫn tiếng Việt).
    try:
        _speak_gtts(args.text, args.out)
        print("TTS engine: gtts")
        return 0
    except ImportError:
        errors.append("gTTS: chưa cài — " + _install_hint())
    except Exception as exc:  # noqa: BLE001
        errors.append(f"gTTS: {exc}")

    print("TTS failed: " + " | ".join(errors), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
