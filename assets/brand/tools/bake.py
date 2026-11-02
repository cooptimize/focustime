import os, re, sys
SRC="/home/claude/brand/assets"
THEMES={"dark":{"brand-am":"#1E3A55","brand-pm":"#4FA3DD","accent":"#9CC24F","lime":"#B2D235","ghost":"#2B3A4D","cur":"#E6ECF2","bg":"#0E1620"},
        "light":{"brand-am":"#7FA6C9","brand-pm":"#00416B","accent":"#42783C","lime":"#B2D235","ghost":"#9FB3C6","cur":"#14212E","bg":"#F5F7FA"}}
for theme,t in THEMES.items():
    out=f"/home/claude/brand/baked/{theme}"; os.makedirs(out,exist_ok=True)
    for f in os.listdir(SRC):
        s=open(f"{SRC}/{f}").read()
        for k,v in t.items(): s=s.replace(f"var(--{k})",v)
        s=s.replace("currentColor",t["cur"])
        s=re.sub(r"<style>\n:root\{[^}]*\}\n</style>","",s)
        open(f"{out}/{f}","w").write(s)
print("baked")
