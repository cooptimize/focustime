import os, re, sys
HERE=os.path.dirname(os.path.abspath(__file__))
SRC=os.path.join(HERE,"..")  # assets/brand/, values match the brand tokens in ui/styles.css
THEMES={"dark":{"brand-am":"#1E3A55","brand-pm":"#4FA3DD","accent":"#9CC24F","lime":"#B2D235","ghost":"#2B3A4D","beam-blend":"screen","cur":"#E6ECF2","bg":"#0E1620"},
        "light":{"brand-am":"#7FA6C9","brand-pm":"#00416B","accent":"#42783C","lime":"#B2D235","ghost":"#B9C6D3","beam-blend":"multiply","cur":"#14212E","bg":"#F5F7FA"}}
for theme,t in THEMES.items():
    out=os.path.join(SRC,"baked",theme); os.makedirs(out,exist_ok=True)
    for f in sorted(x for x in os.listdir(SRC) if x.endswith(".svg") and x != "favicon.svg"):
        s=open(f"{SRC}/{f}").read()
        for k,v in t.items(): s=s.replace(f"var(--{k})",v)
        s=s.replace("currentColor",t["cur"])
        s=re.sub(r"<style>\n:root\{[^}]*\}\n</style>","",s)
        open(f"{out}/{f}","w").write(s)
print("baked")
