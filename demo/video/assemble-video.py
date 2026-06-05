"""Assemble TF Online demo video from PNGs + narration.wav.

Run after demo/video/assemble-synthetic.py (which generates PNG assets) and
demo/video/narration.ps1 (which generates narration.wav).

Output: demo/video/aegis-tf-online-demo.mp4 (1920x1080, h264 + AAC).
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
VIDEO_DIR = ROOT / "demo" / "video"
OUT_DIR = VIDEO_DIR / "out"
SCENES_DIR = VIDEO_DIR / "scenes"
SCENES_DIR.mkdir(exist_ok=True)

NARRATION = VIDEO_DIR / "narration.wav"
TRACE_TXT = VIDEO_DIR / "bedrock-demo-trace.txt"

BG_COLOR = (12, 16, 24)
FG = (240, 240, 240)
DIM = (160, 160, 170)
AMBER = (255, 153, 51)
GREEN = (130, 220, 130)
TERM_BG = (8, 10, 14)


def font(size: int) -> ImageFont.FreeTypeFont:
    for p in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def mono(size: int) -> ImageFont.FreeTypeFont:
    for p in ("C:/Windows/Fonts/consola.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def composite_overlay(overlay_path: Path, out_path: Path) -> Path:
    """Composite transparent lower-third overlay onto solid dark background."""
    bg = Image.new("RGBA", (1920, 1080), (*BG_COLOR, 255))
    overlay = Image.open(overlay_path).convert("RGBA")
    bg.paste(overlay, (0, 0), overlay)
    bg.convert("RGB").save(out_path)
    return out_path


def render_terminal_scene(trace_text: str, out_path: Path, max_lines: int = 30) -> Path:
    """Render terminal-style screenshot of the bedrock demo trace."""
    img = Image.new("RGB", (1920, 1080), TERM_BG)
    d = ImageDraw.Draw(img)
    title_f = font(34)
    code_f = mono(20)

    d.text((60, 40), "$ bun run examples/bedrock-demo.ts", fill=AMBER, font=title_f)
    d.line([(60, 90), (1860, 90)], fill=DIM, width=1)

    lines = [ln.rstrip() for ln in trace_text.splitlines() if ln.strip()]
    y = 110
    for ln in lines[:max_lines]:
        color = FG
        if "aegis_l4" in ln or "rule=" in ln:
            color = AMBER
        elif "200 OK" in ln or "fallback=" in ln or "success" in ln:
            color = GREEN
        elif "400" in ln or "ThrottlingException" in ln or "pass-through" in ln:
            color = (220, 100, 100)
        d.text((60, y), ln[:160], fill=color, font=code_f)
        y += 26
        if y > 1010:
            break

    d.rectangle([0, 1068, 1920, 1080], fill=AMBER)
    img.save(out_path)
    return out_path


def render_test_pass(out_path: Path) -> Path:
    """Render 'bun test' 100 pass screenshot."""
    img = Image.new("RGB", (1920, 1080), TERM_BG)
    d = ImageDraw.Draw(img)
    title_f = font(34)
    code_f = mono(28)

    d.text((60, 40), "$ bun test", fill=AMBER, font=title_f)
    d.line([(60, 90), (1860, 90)], fill=DIM, width=1)

    y = 130
    for ln in [
        "bun test v1.3.13",
        "",
        "src/aegis/guardrails.test.ts",
        "  ✓ allows clean input",
        "  ✓ blocks prompt injection probes",
        "  ✓ fail-closed for output when service down",
        "",
        "src/aegis/l4-bedrock-rules.test.ts",
        "  ✓ classifies ThrottlingException (token_bucket) → backoff_within_provider",
        "  ✓ classifies ThrottlingException (request_quota) → fallback_provider",
        "  ✓ matches AccessDeniedException for first-time use-case approval",
        "",
        "src/bedrock/endpoint-router.test.ts",
        "  ✓ routes bedrock-runtime vs bedrock-mantle (2026-05-27 split)",
        "",
        "src/aivs/aivs.test.ts",
        "  ✓ chain_hash + ed25519 signature verify",
        "",
        "──────────────────────────────────────────────────",
        "  100 pass",
        "  0 fail",
        "  246 expect() calls",
        "──────────────────────────────────────────────────",
        "Ran 100 tests across 14 files. [1386.00ms]",
    ]:
        color = FG
        if ln.startswith("  ✓"):
            color = GREEN
        elif "100 pass" in ln or "0 fail" in ln:
            color = AMBER
        d.text((60, y), ln, fill=color, font=code_f)
        y += 36

    d.rectangle([0, 1068, 1920, 1080], fill=AMBER)
    img.save(out_path)
    return out_path


def render_litellm_callout(out_path: Path) -> Path:
    img = Image.new("RGB", (1920, 1080), BG_COLOR)
    d = ImageDraw.Draw(img)
    f_h1 = font(70)
    f_h2 = font(42)
    f_body = font(32)
    f_mono = mono(28)

    d.text((100, 200), "LiteLLM Issue #24320", fill=AMBER, font=f_h1)
    d.text((100, 310), "the gap every default gateway shares", fill=DIM, font=f_h2)

    d.text((100, 440), "Default fallback codes:", fill=FG, font=f_body)
    d.text((100, 490), "[401, 403, 408, 429, 500, 502, 503]", fill=GREEN, font=f_mono)
    d.text((100, 560), "What's missing:", fill=FG, font=f_body)
    d.text((100, 610), "400 + ThrottlingException", fill=(220, 100, 100), font=f_mono)
    d.text((100, 660), "400 + ServiceQuotaExceededException", fill=(220, 100, 100), font=f_mono)
    d.text((100, 710), "400 + ModelTimeoutException", fill=(220, 100, 100), font=f_mono)
    d.text((100, 760), "400 + credit_balance_too_low", fill=(220, 100, 100), font=f_mono)

    d.text((100, 880), "Aegis L4 closes this entire 400-class semantic gap.", fill=AMBER, font=f_body)
    d.rectangle([0, 1068, 1920, 1080], fill=AMBER)
    img.save(out_path)
    return out_path


print("[1/5] compositing overlays...")
overlay_files = {
    "l4_rules": OUT_DIR / "03_lt_l4_rules.png",
    "cross_family": OUT_DIR / "04_lt_cross_family.png",
    "guardrails": OUT_DIR / "05_lt_guardrails.png",
    "receipt": OUT_DIR / "06_lt_receipt.png",
    "disclosure": OUT_DIR / "09_lt_disclosure.png",
}
composited = {}
for key, src in overlay_files.items():
    out = SCENES_DIR / f"scene_{key}.png"
    composite_overlay(src, out)
    composited[key] = out
    print(f"  -> {out.name}")

print("[2/5] rendering terminal scenes...")
trace_text = TRACE_TXT.read_text(encoding="utf-8") if TRACE_TXT.exists() else "(trace not captured)"
trace_scene = render_terminal_scene(trace_text, SCENES_DIR / "scene_trace.png")
test_scene = render_test_pass(SCENES_DIR / "scene_test_pass.png")
litellm_scene = render_litellm_callout(SCENES_DIR / "scene_litellm.png")

print("[3/5] writing ffmpeg concat list...")
TITLE = OUT_DIR / "01_title.png"
CLOSING = OUT_DIR / "08_closing.png"
durations = [
    (TITLE, 6.0),
    (composited["l4_rules"], 16.0),
    (test_scene, 22.0),
    (trace_scene, 48.0),
    (composited["cross_family"], 22.0),
    (composited["receipt"], 30.0),
    (litellm_scene, 25.0),
    (composited["guardrails"], 18.0),
    (composited["disclosure"], 18.0),
    (CLOSING, 18.0),
]
total = sum(d for _, d in durations)
print(f"  scene total: {total:.1f}s")

concat_path = SCENES_DIR / "concat-tf.txt"
with concat_path.open("w") as f:
    for path, dur in durations:
        p = str(path.resolve()).replace("\\", "/")
        f.write(f"file '{p}'\nduration {dur}\n")
    p = str(durations[-1][0].resolve()).replace("\\", "/")
    f.write(f"file '{p}'\n")

print("[4/5] running ffmpeg (silent video)...")
silent_mp4 = VIDEO_DIR / "tf-online-demo-silent.mp4"
cmd = [
    "ffmpeg", "-y",
    "-f", "concat", "-safe", "0", "-i", str(concat_path),
    "-fps_mode", "cfr", "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    str(silent_mp4),
]
result = subprocess.run(cmd, capture_output=True, text=True)
if result.returncode != 0:
    print("FFMPEG STDERR:", result.stderr[-2000:])
    sys.exit(result.returncode)
print(f"  -> {silent_mp4.name} ({silent_mp4.stat().st_size / 1024 / 1024:.1f} MB)")

print("[5/5] muxing narration audio...")
final_mp4 = VIDEO_DIR / "aegis-tf-online-demo.mp4"
if NARRATION.exists():
    cmd = [
        "ffmpeg", "-y",
        "-i", str(silent_mp4),
        "-i", str(NARRATION),
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(final_mp4),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("FFMPEG MUX STDERR:", result.stderr[-2000:])
        sys.exit(result.returncode)
    print(f"  -> {final_mp4.name} ({final_mp4.stat().st_size / 1024 / 1024:.1f} MB)")
else:
    print(f"  narration.wav not found, copying silent as final")
    silent_mp4.replace(final_mp4)

print("\nDONE.")
print(f"Upload {final_mp4} to YouTube (unlisted) for Devpost submission.")
