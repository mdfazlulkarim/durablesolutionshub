"""Builds assets/icons.js: the OCHA Humanitarian Icons used on the Operational Presence page,
as small inline SVGs that take the colour of the text around them.

Source: OCHA Humanitarian Icons (https://brand.unocha.org/), for example the SVG copies in
https://github.com/rodekruis/OCHA-Humanitarian-Icons (folder svg/).

Usage (run from sudan/presence/):
    python3 scripts/build_icons.py <folder with the OCHA .svg files>
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "assets", "icons.js")

# key used on the page -> OCHA icon file name
ICONS = {
    "health": "Health",
    "protection": "Protection",
    "nutrition": "Nutrition",
    "food-security": "Food-Security",
    "cash": "Cash-transfer",
    "education": "Education",
    "wash": "Water-Sanitation-and-Hygiene",
    "refugee": "Refugee",
    "shelter": "Shelter",
    "logistics": "Logistics",
    "cccm": "Camp-Coordination-and-Camp-Management",
    "telecom": "Emergency-Telecommunications",
    "coordination": "Coordination",
    "partnership": "Partnership",
    "multi-cluster": "Multi-cluster-sector",
    "map": "Map",
    "location": "Location",
    "people-targeted": "People-targeted",
}
SHAPES = {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}
KEEP = {"d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "points", "x1", "y1", "x2", "y2", "transform"}


def tidy(v):
    return re.sub(r"\s+", " ", v).strip()


def convert(path):
    root = ET.parse(path).getroot()
    vb = tidy(root.get("viewBox"))
    parts = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag not in SHAPES:
            continue
        attrs = " ".join(f'{k}="{tidy(v)}"' for k, v in el.attrib.items() if k in KEEP)
        parts.append(f"<{tag} {attrs}/>")
    if not parts:
        sys.exit(f"No shapes found in {path}")
    return f'<svg viewBox="{vb}" fill="currentColor" aria-hidden="true" focusable="false">{"".join(parts)}</svg>'


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    icons = {k: convert(os.path.join(src, f"{name}.svg")) for k, name in ICONS.items()}
    body = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v)}" for k, v in icons.items())
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* OCHA Humanitarian Icons (United Nations Office for the Coordination of Humanitarian Affairs), released for free use.\n"
                "   Built by scripts/build_icons.py. */\n\"use strict\";\nwindow.SF = window.SF || {};\nSF.OCHA_OP = {\n" + body + "\n};\n")
    print(f"{OUT}: {len(icons)} icons, {os.path.getsize(OUT) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
