"""Generate the FocusTime identity SVGs from measured Cooptimize geometry.

BR-1: the week mark is the only brand mark. The bent ring, the loading sweep, the unroll frames and the old lockup
are no longer made; mark-week, its mono form, the symbolic icon, the wordmark and the favicon are drawn as before."""
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")  # assets/brand/
os.makedirs(OUT, exist_ok=True)

TOKENS = """<style>
:root{--brand-am:#1E3A55;--brand-pm:#4FA3DD;--accent:#9CC24F;--ghost:#2B3A4D}
</style>"""

def svg(w, h, body, title, desc, tokens=True):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img">'
            f'<title>{title}</title><desc>{desc}</desc>{TOKENS if tokens else ""}{body}</svg>')

def write(name, content):
    with open(os.path.join(OUT, name), "w") as f: f.write(content)

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
write("mark-week.svg", svg(ww, wh, wk, "FocusTime mark, unrolled week", "Four columns Mon to Thu, AM over PM, Mon AM hollow."))
wkm, _, _ = week("currentColor", "currentColor", "currentColor")
write("mark-week-mono.svg", svg(ww, wh, wkm, "FocusTime mark, unrolled week, mono", "Single color form.", tokens=False))

# symbolic: 16x16 grid, pixel-aligned
sym = []
for c in range(4):
    x = c*4
    if c == 0:
        sym.append(f'<rect x="{x+0.5}" y="2.5" width="2" height="2" fill="none" stroke="currentColor" stroke-width="1"/>')
    else:
        sym.append(f'<rect x="{x}" y="2" width="3" height="3" fill="currentColor"/>')
    sym.append(f'<rect x="{x}" y="7" width="3" height="5" fill="currentColor"/>')
write("focustime-symbolic.svg", svg(16, 16, "\n".join(sym), "FocusTime symbolic icon", "16 px grid, one hollow block.", tokens=False))

# ---------- wordmark ----------
word = '<text x="0" y="44" font-family="IBM Plex Sans, Inter, system-ui, sans-serif" font-weight="600" font-size="48" letter-spacing="-1.2" fill="currentColor">FocusTime</text>'
write("wordmark.svg", svg(285, 60, word, "FocusTime wordmark", "IBM Plex Sans 600, outlined to paths by tools/outline.mjs.", tokens=False))

print("ok", sorted(os.listdir(OUT)))

# ---------- favicon (step 17.5): mark-week in a square, dark by default, light under prefers-color-scheme ----------
fav, _, _ = week("var(--am)", "var(--pm)", "var(--hollow)")
fav_style = ("<style>svg{--am:#2F5F8C;--pm:#4FA3DD;--hollow:#9CC24F}"
             "@media (prefers-color-scheme: light){svg{--am:#7FA6C9;--pm:#00416B;--hollow:#42783C}}</style>")
write("favicon.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -55 200 200" width="32" height="32">{fav_style}{fav}</svg>')
