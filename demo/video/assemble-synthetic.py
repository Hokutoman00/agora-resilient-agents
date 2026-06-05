# Pre-render demo scene PNG assets for the TF Online Hackathon demo video.
# Same pattern as the aegis-splunk Splunk Agentic Ops submission demo.
#
# Run with:
#   python demo/video/assemble-synthetic.py
#
# Generates:
#   out/01_title.png
#   out/08_closing.png
#   out/03_lt_l4_rules.png        (lower-third overlays)
#   out/04_lt_cross_family.png
#   out/05_lt_guardrails.png
#   out/06_lt_receipt.png
#   out/07_lt_litellm_24320.png
#   out/09_lt_disclosure.png
#
# Live terminal capture for `bun test` and `bun run examples/bedrock-demo.ts`
# is recorded separately during the demo session; this script handles only
# the static composite assets so the kickoff window is record-only.

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

W, H = 1920, 1080

# Color scheme — dark TF-orange / Aegis-amber palette
BG = (12, 16, 24)
FG = (240, 240, 240)
AMBER = (255, 153, 51)
GREEN = (76, 217, 100)
DIM = (160, 160, 170)
PANEL = (24, 30, 42, 220)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def load_mono(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/consola.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def center_text(draw: ImageDraw.ImageDraw, y: int, text: str, font, color=FG):
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    x = (W - text_w) // 2
    draw.text((x, y), text, fill=color, font=font)


def make_title():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_h1 = load_font(96)
    f_h2 = load_font(46)
    f_h3 = load_font(34)
    f_h4 = load_font(28)

    center_text(d, 320, "aegis-tf-resilient-online", f_h1, AMBER)
    center_text(d, 440, "TrueFoundry Resilient Agents — Online Hackathon", f_h2)
    center_text(d, 510, "2026-06-01 to 06-07", f_h3, DIM)
    center_text(d, 680, "Hedge first.  Fallback second.  Continuously chaos-verified.", f_h4)
    center_text(d, 720, "For agents on TrueFoundry AI Gateway + AWS Bedrock.", f_h4, DIM)

    # Bottom accent
    d.rectangle([0, H - 12, W, H], fill=AMBER)
    img.save(OUT / "01_title.png")


def lower_third(filename: str, badge: str, headline: str, sub: str | None = None):
    """Generates a transparent-ish lower-third overlay (full frame, but bottom 1/3 is the panel)."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f_badge = load_font(28)
    f_head = load_font(54)
    f_sub = load_font(30)

    # Panel — bottom 1/3, semi-opaque dark
    panel_top = int(H * 0.66)
    d.rectangle([0, panel_top, W, H], fill=PANEL)

    # Left accent bar
    d.rectangle([0, panel_top, 16, H], fill=AMBER)

    # Badge
    d.text((80, panel_top + 40), badge, font=f_badge, fill=AMBER)

    # Headline
    d.text((80, panel_top + 100), headline, font=f_head, fill=FG)

    # Sub
    if sub:
        d.text((80, panel_top + 180), sub, font=f_sub, fill=DIM)

    img.save(OUT / filename)


def make_closing():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_h1 = load_font(74)
    f_h2 = load_font(42)
    f_h3 = load_font(34)
    f_mono = load_mono(36)

    center_text(d, 250, "aegis-tf-resilient-online", f_h1, AMBER)
    center_text(d, 360, "Verify in 5 minutes:", f_h3, DIM)

    # Code-style block
    code_y = 430
    code_lines = [
        "git clone github.com/Hokutoman00/aegis-tf-resilient-online",
        "cd aegis-tf-resilient-online && bun install",
        "bun test    # 100 pass, 0 fail",
    ]
    for i, line in enumerate(code_lines):
        center_text(d, code_y + i * 50, line, f_mono, GREEN)

    center_text(d, 700, "MIT license  ·  github.com/Hokutoman00/aegis-tf-resilient-online", f_h3)
    center_text(d, 760, "Built on aegis-resilient-agents (DevNetwork TF Resilient winner 2026)", f_h3, DIM)

    # Bottom accent
    d.rectangle([0, H - 12, W, H], fill=AMBER)
    img.save(OUT / "08_closing.png")


def main():
    make_title()
    print(f"  wrote {OUT / '01_title.png'}")

    lower_third(
        "03_lt_l4_rules.png",
        "AEGIS · LAYER 4 SEMANTIC RECLASSIFICATION",
        "9 Bedrock-specific rules for the errors gateways miss",
        "ThrottlingException · ServiceQuotaExceeded · ModelStreamError · AccessDeniedException",
    )
    print(f"  wrote {OUT / '03_lt_l4_rules.png'}")

    lower_third(
        "04_lt_cross_family.png",
        "AEGIS · CROSS-FAMILY FALLBACK",
        "Never retry the vendor that just throttled",
        "anthropic → meta → mistral → cohere → amazon nova",
    )
    print(f"  wrote {OUT / '04_lt_cross_family.png'}")

    lower_third(
        "05_lt_guardrails.png",
        "AEGIS · COMPOSED GUARDRAILS",
        "TF Gateway + Bedrock + Aegis-local",
        "fail-closed for output  ·  fail-open for input  ·  prompt-injection + PII catch even when services are down",
    )
    print(f"  wrote {OUT / '05_lt_guardrails.png'}")

    lower_third(
        "06_lt_receipt.png",
        "AEGIS · RECEIPT",
        "Signed JSON envelope on every response",
        "providers tried · layers fired · guardrail decisions · last chaos drill survival",
    )
    print(f"  wrote {OUT / '06_lt_receipt.png'}")

    lower_third(
        "07_lt_litellm_24320.png",
        "INDUSTRY GAP · LITELLM ISSUE #24320",
        "credit_balance_too_low passes through every default gateway",
        "the L4 layer is what closes the entire 400-class semantic gap",
    )
    print(f"  wrote {OUT / '07_lt_litellm_24320.png'}")

    lower_third(
        "09_lt_disclosure.png",
        "DISCLOSURE",
        "Built on aegis-resilient-agents (DevNetwork TF Resilient winner)",
        "Bedrock provider + L4 rules + Guardrails + demo are NEW.  Core primitives reused with disclosure.",
    )
    print(f"  wrote {OUT / '09_lt_disclosure.png'}")

    make_closing()
    print(f"  wrote {OUT / '08_closing.png'}")

    print("\nAll 8 assets generated in:", OUT)
    print("Next: capture live terminal (bun test + bun run examples/bedrock-demo.ts)")
    print("Then: composite + mux per demo/video/narration-bedrock.md scene plan")


if __name__ == "__main__":
    main()
