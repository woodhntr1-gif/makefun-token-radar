#!/usr/bin/env python3
"""Render the 3 dashboard screenshots as PNGs with PIL, from a generated
/output/board.json + data (same figures the page renders).

Method note: the sandbox's Chromium build refuses standalone headless runs
("Hatch WebGL domain policy is required for browser startup"), so the
screenshots are drawn by this script replicating the dashboard's layout,
colours and data 1:1. On a normal machine, replace them with real browser
captures of dashboard/index.html, ?detail=<top slug> and ?cat=Dexs.
"""
import json, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "screenshots"
BOARD = json.load(open(sys.argv[2]))["rows"] if len(sys.argv) > 2 else None
W, H = 1280, 900
BG = (11, 15, 20); PANEL = (17, 24, 35); LINE = (34, 48, 74)
INK = (232, 238, 247); DIM = (147, 163, 186); FAINT = (100, 118, 145)
ACCENT = (255, 180, 84); GREEN = (61, 220, 151); RED = (255, 107, 107); BLUE = (93, 185, 255)
FD = "/usr/share/fonts/truetype/dejavu/"
F = lambda n, s: ImageFont.truetype(FD + n, s)
TITLE = F("DejaVuSans-Bold.ttf", 30); H2 = F("DejaVuSans-Bold.ttf", 22)
BODY = F("DejaVuSans.ttf", 15); BOLD = F("DejaVuSans-Bold.ttf", 15)
SMALL = F("DejaVuSans.ttf", 13); SMALLB = F("DejaVuSans-Bold.ttf", 13)

def money(n):
    if n is None: return "—"
    if abs(n) >= 1e9: return f"${n/1e9:.2f}B"
    if abs(n) >= 1e6: return f"${n/1e6:.1f}M"
    if abs(n) >= 1e3: return f"${n/1e3:.1f}K"
    return f"${round(n)}"

def header(d, subtitle):
    d.text((28, 22), "TOKEN LAUNCH RADAR · MODEL RADAR-2", font=SMALLB, fill=ACCENT)
    d.text((28, 46), "Pre-token protocols, ranked by what", font=TITLE, fill=INK)
    d.text((28, 84), "their token could be worth", font=TITLE, fill=INK)
    d.text((28, 128), subtitle, font=BODY, fill=DIM)
    d.line([(28, 168), (W - 28, 168)], fill=ACCENT, width=2)

def stats(d, y=186):
    total = sum(r["implied_value_usd"] for r in BOARD)
    wl = sum(1 for r in BOARD if r["watchlist"])
    cards = [(f"{len(BOARD)}", "PROTOCOLS RANKED"), (money(total), "TOTAL IMPLIED VALUE"),
             (BOARD[0]["name"][:20], "#1 IMPLIED " + money(BOARD[0]["implied_value_usd"])),
             (f"{wl} / {len(BOARD)}", "WATCHLIST / BOARD")]
    x = 28
    for val, lab in cards:
        d.rounded_rectangle([x, y, x + 290, y + 62], 8, fill=PANEL, outline=LINE)
        d.text((x + 14, y + 8), val, font=H2, fill=INK)
        d.text((x + 14, y + 40), lab, font=SMALL, fill=FAINT)
        x += 302
    return y + 78

def table(d, rows, y, title=None):
    if title:
        d.text((28, y), title, font=BOLD, fill=INK); y += 30
    d.rounded_rectangle([28, y, W - 28, y + 34 + 34 * len(rows)], 6, fill=PANEL, outline=LINE)
    cols = [(44, "#"), (84, "Protocol"), (470, "Category"), (640, "Chains"), (880, "TVL"), (1000, "7d"), (1090, "Implied")]
    for x, t in cols:
        d.text((x, y + 9), t.upper(), font=SMALLB, fill=FAINT)
    yy = y + 34
    for r in rows:
        d.line([(28, yy), (W - 28, yy)], fill=(26, 38, 55))
        d.text((44, yy + 8), str(r["rank"]), font=BODY, fill=FAINT)
        name = r["name"][:30]
        d.text((84, yy + 8), name, font=BOLD, fill=(255, 255, 255))
        nw = d.textlength(name, font=BOLD)
        tag, col = ("watchlist", ACCENT) if r["watchlist"] else ("early", BLUE)
        d.text((88 + nw, yy + 10), tag, font=SMALL, fill=col)
        d.text((470, yy + 8), (r["category"] or "—")[:17], font=BODY, fill=DIM)
        d.text((640, yy + 8), ", ".join(r["chains"][:2])[:26], font=SMALL, fill=FAINT)
        d.text((880, yy + 8), money(r["tvl_usd"]), font=BODY, fill=INK)
        c = r["change_7d"]
        txt = "—" if c is None else f"{c:+.1f}%"
        d.text((1000, yy + 8), txt, font=BODY, fill=GREEN if (c or 0) >= 0 else RED)
        d.text((1090, yy + 8), money(r["implied_value_usd"]), font=BOLD, fill=ACCENT)
        yy += 34
    return yy + 16

def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if d.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w_
    if cur: lines.append(cur)
    return lines

# 1 — the board
img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
header(d, f"Every pre-token protocol in the sealed snapshot — the whole watchlist plus early finds below the $50.0M floor.")
y = stats(d)
d.rounded_rectangle([28, y, W - 28, y + 44], 6, fill=(14, 20, 29), outline=LINE)
d.text((42, y + 6), "The model: implied = TVL x category x momentum x breadth x maturity. DEX 0.85 · lending 0.55 · bridges 0.30 · launchpads 1.15.", font=SMALL, fill=DIM)
d.text((42, y + 24), "Filters:  Search [ name or slug ]   Category [ All categories ]   Chain [ All chains ]   [ ] Watchlist only", font=SMALL, fill=DIM)
table(d, BOARD[:11], y + 58)
img.save(f"{OUT}/1-board.png", optimize=True)

# 2 — a protocol's detail view
r = BOARD[0]; m = r["model"]
img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
header(d, "Detail view — click any row on the board to open it.")
y = stats(d)
d.rounded_rectangle([28, y, W - 28, y + 470], 10, fill=PANEL, outline=ACCENT, width=2)
d.text((48, y + 16), f"#{r['rank']} {r['name']}", font=H2, fill=(255, 255, 255))
meta = f"{r['category'] or 'Uncategorised'} · {', '.join(r['chains'][:4])} · TVL {money(r['tvl_usd'])} · records no token yet"
d.text((48, y + 50), meta, font=BODY, fill=DIM)
boxes = [("IMPLIED VALUE", money(r["implied_value_usd"])), ("CATEGORY x", f"{m['category_multiple']:.2f}"),
         ("MOMENTUM x", f"{m['momentum_multiplier']:.2f}"), ("BREADTH x", f"{m['breadth_multiplier']:.2f}"),
         ("MATURITY x", f"{m['maturity_multiplier']:.2f}")]
x = 48
for lab, val in boxes:
    d.rounded_rectangle([x, y + 84, x + 218, y + 144], 8, fill=(14, 20, 29), outline=LINE)
    d.text((x + 12, y + 92), lab, font=SMALL, fill=FAINT)
    d.text((x + 12, y + 110), val, font=H2, fill=ACCENT if lab == "IMPLIED VALUE" else INK)
    x += 230
d.text((48, y + 164), "HOW TO FARM IT", font=SMALLB, fill=ACCENT)
yy = y + 190
for i, s in enumerate(r["farm_steps"][:5], 1):
    lines = wrap(d, s, SMALL, 1130)
    d.text((48, yy), f"{i}.", font=SMALLB, fill=ACCENT)
    for ln in lines[:2]:
        d.text((72, yy), ln, font=SMALL, fill=DIM); yy += 18
    yy += 6
img.save(f"{OUT}/2-detail.png", optimize=True)

# 3 — a filtered view (category = Dexs)
dex = [x for x in BOARD if x["category"] == "Dexs"]
img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
header(d, "Filtered view — Category: Dexs. Every filter combines with search, chain and watchlist-only.")
y = stats(d)
d.rounded_rectangle([28, y, W - 28, y + 44], 6, fill=(14, 20, 29), outline=LINE)
d.text((42, y + 12), f"Filters:  Search [              ]   Category [ Dexs  v ]   Chain [ All chains ]   [ ] Watchlist only      Showing {len(dex)} of {len(BOARD)}", font=SMALL, fill=DIM)
table(d, dex[:12], y + 58)
img.save(f"{OUT}/3-filtered.png", optimize=True)
print("wrote 3 screenshots to", OUT)
