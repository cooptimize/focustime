"""Generate the Coopilot identity SVGs from measured Cooptimize geometry."""
import math, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")  # assets/brand/
os.makedirs(OUT, exist_ok=True)

# Measured from Cooptimize Logo_Icon-Color.png (1175 px), normalized to outer ring mid-radius = 100
RINGS = [  # (mid radius, stroke width) inner -> outer
    (51.0, 16.0), (69.0, 11.5), (84.5, 11.7), (100.0, 11.7)]
GUTTER = 4.5
OPEN = 45          # opening half-angle, degrees, parent is +-45 around the right
CUT = GUTTER       # linear gap at the horizontal centerline

TOKENS = """<style>
:root{--brand-am:#1E3A55;--brand-pm:#4FA3DD;--accent:#9CC24F;--lime:#B2D235;--ghost:#2B3A4D;--beam-blend:screen}
</style>"""

def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r*math.cos(a), cy + r*math.sin(a)

def arc(cx, cy, r, a0, a1, stroke, w, extra=""):
    """Arc from a0 to a1 degrees, clockwise in screen coords (y down)."""
    x0, y0 = pt(cx, cy, r, a0); x1, y1 = pt(cx, cy, r, a1)
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return (f'<path d="M{x0:.2f} {y0:.2f} A{r} {r} 0 {large} 1 {x1:.2f} {y1:.2f}" '
            f'fill="none" stroke="{stroke}" stroke-width="{w}" {extra}/>')

def ring_segments(cx, cy, am, pm, ghost, inner_am_ghost=True, w_scale=1.0):
    out = []
    for i, (r, w) in enumerate(RINGS):
        gap_deg = math.degrees(CUT/2 / r)
        # AM: upper half, from left (180) clockwise to the opening at 360-OPEN
        a0, a1 = 180 + gap_deg, 360 - OPEN
        if i == 0 and inner_am_ghost:
            out.append(arc(cx, cy, r, a0, a1, ghost, 3*w_scale,
                           'stroke-dasharray="6 5" stroke-linecap="butt"'))
        else:
            out.append(arc(cx, cy, r, a0, a1, am, w*w_scale))
        # PM: lower half, from the opening (OPEN) clockwise to left (180)
        out.append(arc(cx, cy, r, OPEN, 180 - gap_deg, pm, w*w_scale))
    return "\n".join(out)

def beam_grad(gid, x0, x1):
    """Lime fading to transparent along the beam (step 17.5): 0.85 at the bar, 0.25 just past half, 0 at the far end."""
    return (f'<defs><linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{x0:.2f}" y1="0" x2="{x1:.2f}" y2="0">'
            f'<stop offset="0" stop-color="var(--lime)" stop-opacity="0.85"/><stop offset="0.55" stop-color="var(--lime)" stop-opacity="0.25"/>'
            f'<stop offset="1" stop-color="var(--lime)" stop-opacity="0"/></linearGradient></defs>')

def lumen(x, y, size, body, bar, light=True, light_dir=-1, gid="beam"):
    """Lumen: an upright rounded block with a light bar on the edge facing light_dir (-1 left, +1 right).
    The beam is level and symmetric about the bar: as tall as the bar where it leaves it, about 1.8x Lumen's
    height at the far end, about 2.3x Lumen's width long, lime fading out, blended with screen (dark) or multiply (light)."""
    r = size*0.2; bw = size*0.15; bh = size*0.45
    bx = x if light_dir < 0 else x + size - bw
    cy = y + size/2
    g = []
    if light:
        tip = x if light_dir < 0 else x + size
        far = tip + light_dir*size*2.3
        g.append(beam_grad(gid, tip, far))
        g.append(f'<path d="M{tip:.2f} {cy-bh/2:.2f} L{far:.2f} {cy-size*0.9:.2f} L{far:.2f} {cy+size*0.9:.2f} L{tip:.2f} {cy+bh/2:.2f} Z" '
                 f'fill="url(#{gid})" style="mix-blend-mode:var(--beam-blend)"/>')
    g.append(f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{r}" fill="{body}"/>')
    g.append(f'<rect x="{bx}" y="{y+(size-bh)/2}" width="{bw}" height="{bh}" rx="{bw/3}" fill="{bar}"/>')
    return "\n".join(g)

def svg(w, h, body, title, desc, tokens=True):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img">'
            f'<title>{title}</title><desc>{desc}</desc>{TOKENS if tokens else ""}{body}</svg>')

def write(name, content):
    with open(os.path.join(OUT, name), "w") as f: f.write(content)

# ---------- mark-bent ----------
CX, CY = 118, 118
bent_color = ring_segments(CX, CY, "var(--brand-am)", "var(--brand-pm)", "var(--ghost)")
bent_color += lumen(206, 103, 30, "var(--accent)", "var(--lime)", light=True, light_dir=-1, gid="beam-bent")
write("mark-bent.svg", svg(260, 236, bent_color, "Coopilot mark, bent week",
      "Eight ring segments opening right, AM above PM, inner AM segment ghosted; Lumen stands outside the opening, light pointing in."))

bent_mono = ring_segments(CX, CY, "currentColor", "currentColor", "currentColor")
bent_mono += lumen(206, 103, 30, "currentColor", "currentColor", light=False)
write("mark-bent-mono.svg", svg(260, 236, bent_mono, "Coopilot mark, bent week, mono", "Single color form.", tokens=False))

# ---------- mark-week ----------
def week(am, pm, hollow, hollow_stroke=True):
    bw, amh, pmh, cg, rg, rx = 40, 26, 32, 8, 16, 6
    out = []
    x0, y0 = 8, 8
    for c in range(4):
        x = x0 + c*(bw+cg)
        if c == 0 and hollow_stroke:
            out.append(f'<rect x="{x+1.5}" y="{y0+1.5}" width="{bw-3}" height="{amh-3}" rx="{rx-1}" fill="none" stroke="{hollow}" stroke-width="3"/>')
        else:
            out.append(f'<rect x="{x}" y="{y0}" width="{bw}" height="{amh}" rx="{rx}" fill="{am}"/>')
        out.append(f'<rect x="{x}" y="{y0+amh+rg}" width="{bw}" height="{pmh}" rx="{rx}" fill="{pm}"/>')
    return "\n".join(out), x0*2 + 4*bw + 3*cg, y0*2 + amh + rg + pmh

wk, ww, wh = week("var(--brand-am)", "var(--brand-pm)", "var(--accent)")
write("mark-week.svg", svg(ww, wh, wk, "Coopilot mark, unrolled week", "Four columns Mon to Thu, AM over PM, Mon AM hollow."))
wkm, _, _ = week("currentColor", "currentColor", "currentColor")
write("mark-week-mono.svg", svg(ww, wh, wkm, "Coopilot mark, unrolled week, mono", "Single color form.", tokens=False))

# symbolic: 16x16 grid, pixel-aligned
sym = []
for c in range(4):
    x = c*4
    if c == 0:
        sym.append(f'<rect x="{x+0.5}" y="2.5" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1"/>')
    else:
        sym.append(f'<rect x="{x}" y="2" width="3" height="3" fill="currentColor"/>')
    sym.append(f'<rect x="{x}" y="7" width="3" height="5" fill="currentColor"/>')
write("coopilot-symbolic.svg", svg(16, 16, "\n".join(sym), "Coopilot symbolic icon", "16 px grid, one hollow block.", tokens=False))

# ---------- lumen ----------
write("lumen.svg", svg(240, 120, lumen(160, 30, 60, "var(--accent)", "var(--lime)", light=True, light_dir=-1, gid="beam-lumen"),
      "Lumen", "A rounded block with a light bar, light cast to the left."))

# lumen-loading: Lumen at ring centre, light sweeping around
# The sweep: a radial fade about 50 degrees wide (25 each side of the beam), lime at Lumen fading out at the inner ring.
SW = 25; SR = 43
sx, sy0 = pt(CX, CY, SR, -SW); _, sy1 = pt(CX, CY, SR, SW)
sweep = f'''<defs><radialGradient id="sweep-fade" gradientUnits="userSpaceOnUse" cx="{CX}" cy="{CY}" r="{SR+1}">
<stop offset="0" stop-color="var(--lime)" stop-opacity="0.85"/><stop offset="0.55" stop-color="var(--lime)" stop-opacity="0.3"/><stop offset="1" stop-color="var(--lime)" stop-opacity="0"/></radialGradient></defs>
<g style="animation:sweep 2.5s linear infinite;transform-origin:{CX}px {CY}px">
<path d="M{CX} {CY} L{sx:.2f} {sy0:.2f} A{SR} {SR} 0 0 1 {sx:.2f} {sy1:.2f} Z" fill="url(#sweep-fade)" style="mix-blend-mode:var(--beam-blend)"/></g>
<style>@keyframes sweep{{to{{transform:rotate(360deg)}}}}@media(prefers-reduced-motion:reduce){{g[style]{{animation:none!important}}}}</style>'''
loading = ring_segments(CX, CY, "var(--brand-am)", "var(--brand-pm)", "var(--brand-am)", inner_am_ghost=False)
loading += sweep + lumen(CX-15, CY-15, 30, "var(--accent)", "var(--lime)", light=False)
write("lumen-loading.svg", svg(236, 236, loading, "Lumen loading", "Lumen at the ring centre with a sweeping light; stops under reduced motion."))

# ---------- unroll: keyframed as the radius growing, drawn as 5 explicit frames for preview ----------
def bent_at(cx, cy, scale_r, flatten):
    """flatten 0..1: 0 = ring, 1 = flat rows. Approximated by growing radius and shrinking arc span."""
    out = []
    for i, (r, w) in enumerate(RINGS):
        R = r * (1 + 9*flatten)
        span = (135 - OPEN) * (1 - flatten) + 20*flatten
        # AM arc centred on 270 (top), PM arc centred on 90 (bottom)
        cyi = cy - (r - 75)*flatten*0  # keep centre
        am = arc(cx, cy - (R - r), R, 270 - span/2, 270 + span/2, "var(--brand-am)", w)
        pm = arc(cx, cy + (R - r), R, 90 - span/2, 90 + span/2, "var(--brand-pm)", w)
        out += [am, pm]
    return "\n".join(out)

frames = []
for k, f in enumerate([0, 0.25, 0.5, 0.75, 1.0]):
    frames.append(svg(260, 236, ring_segments(CX, CY, "var(--brand-am)", "var(--brand-pm)", "var(--ghost)") if f == 0 else bent_at(CX, CY, 1, f),
                      f"Unroll frame {k}", f"flatten={f}"))
    write(f"unroll-frame-{k}.svg", frames[-1])

# ---------- wordmark and lockup ----------
word = '<text x="0" y="44" font-family="IBM Plex Sans, Inter, system-ui, sans-serif" font-weight="600" font-size="48" letter-spacing="-1.2" fill="currentColor">Coopilot</text>'
write("wordmark.svg", svg(230, 60, word, "Coopilot wordmark", "IBM Plex Sans 600, outlined to paths by tools/outline.mjs.", tokens=False))

lock = f'<g transform="translate(0,6) scale(0.34)">{ring_segments(CX, CY, "var(--brand-am)", "var(--brand-pm)", "var(--ghost)", w_scale=1.2)}{lumen(206, 103, 30, "var(--accent)", "var(--lime)", light=True, gid="beam-lockup")}</g>'
lock += '<text x="100" y="52" font-family="IBM Plex Sans, Inter, system-ui, sans-serif" font-weight="600" font-size="40" letter-spacing="-1" fill="currentColor">Coopilot</text>'
lock += '<text x="101" y="74" font-family="IBM Plex Sans, Inter, system-ui, sans-serif" font-weight="400" font-size="14" fill="currentColor" opacity="0.6">by Cooptimize</text>'
write("lockup-horizontal.svg", svg(300, 92, lock, "Coopilot lockup", "Bent mark, Lumen, wordmark and by-line."))
print("ok", sorted(os.listdir(OUT)))
