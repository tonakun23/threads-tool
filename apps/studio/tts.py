#!/usr/bin/env python3
"""Giọng đọc AI cho Studio.

Thử lần lượt 3 đường, đường nào ra tiếng thì dùng đường đó:
1. Edge TTS qua máy chủ cũ (speech.platform.bing.com).
2. Edge TTS qua máy chủ mới (api.msedgeservices.com) — Microsoft đã
   chuyển Read Aloud sang máy chủ này từ 10/2026; máy chủ cũ trả 403
   hoặc "No audio was received" ở nhiều khu vực (edge-tts #490).
   Máy chủ mới đòi URL có tham số key: vá lúc chạy bằng cách lấy
   TRUSTED_CLIENT_TOKEN từ edge_tts.constants (không ghi cứng token
   vào mã nguồn) + đặt SEC_MS_GEC_VERSION của bản Edge mới.
3. gTTS (Google Translate TTS, tiếng Việt, có sẵn trong
   requirements.txt) — giọng Google, khác Hoài My/Nam Minh nhưng
   vẫn là tiếng Việt.

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

# Máy chủ TTS mới của Microsoft Edge (Read Aloud v2). Máy chủ này đòi
# URL websocket có tham số key (Ocp-Apim-Subscription-Key); URL trần
# không có "?" sẽ làm edge-tts nối "&ConnectionId=..." thành một phần
# của đường dẫn nên máy chủ từ chối. Token lấy lúc chạy từ
# edge_tts.constants, KHÔNG ghi cứng vào mã nguồn.
NEW_WSS_BASE = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
# Phiên bản Sec-MS-GEC của bản Edge dùng cho máy chủ mới (edge-tts #490).
# edge-tts 7.3.1 mặc định dùng "2-143.0.3650.75" cho máy chủ cũ.
NEW_SEC_MS_GEC_VERSION = "2-155.0.4283.45"
EDGE_TIMEOUT = 30


def _new_wss_url() -> str | None:
    """Dựng URL máy chủ mới kèm tham số key, lấy token lúc chạy."""
    try:
        constants = importlib.import_module("edge_tts.constants")
        token = getattr(constants, "TRUSTED_CLIENT_TOKEN", "")
    except Exception:  # noqa: BLE001
        return None
    if not token:
        return None
    return f"{NEW_WSS_BASE}?Ocp-Apim-Subscription-Key={token}"


def _patch_for_new_endpoint() -> bool:
    """Vá edge-tts lúc chạy để gọi máy chủ mới.

    edge-tts đọc URL và phiên bản Sec-MS-GEC khi kết nối, nên gán lại
    WSS_URL + SEC_MS_GEC_VERSION ở cả hai module (constants và
    communicate) trước khi tạo Communicate mới. Trả False khi không
    lấy được token — lượt đó không được chạy lén bằng URL cũ.
    """
    url = _new_wss_url()
    if not url:
        return False
    for mod_name in ("edge_tts.constants", "edge_tts.communicate"):
        try:
            mod = importlib.import_module(mod_name)
            if hasattr(mod, "WSS_URL"):
                setattr(mod, "WSS_URL", url)
            if hasattr(mod, "SEC_MS_GEC_VERSION"):
                setattr(mod, "SEC_MS_GEC_VERSION", NEW_SEC_MS_GEC_VERSION)
        except Exception:  # noqa: BLE001, S110
            pass
    return True


async def _speak_edge(
    text: str, voice: str, rate: str, out: str, use_new_endpoint: bool
) -> None:
    import edge_tts  # noqa: PLC0415

    if use_new_endpoint and not _patch_for_new_endpoint():
        raise RuntimeError("không lấy được TRUSTED_CLIENT_TOKEN từ edge-tts")
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
        return r"cài bằng: .\.venv\Scripts\python.exe -m pip install -r requirements.txt (chạy trong thư mục apps\studio)"
    return "cài bằng: python3 -m pip install -r requirements.txt"


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
    err = asyncio.run(_attempt(_speak_edge(args.text, args.voice, rate, args.out, False)))
    if err is None:
        print("TTS engine: edge-tts")
        return 0
    errors = [f"Edge máy chủ cũ: {err} (edge-tts {_edge_version()})"]

    # Lượt 2: Edge TTS, máy chủ mới (vá URL kèm key + phiên bản GEC).
    err = asyncio.run(_attempt(_speak_edge(args.text, args.voice, rate, args.out, True)))
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
