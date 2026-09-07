#!/usr/bin/env python3
"""Python mirror of src/components/body/skinZones.ts — keep the two in sync.

Maps a numeric region id to (melanin, dryness, vascularity) so the offline QA
render shows the same anatomical skin zoning the WebGL shader looks up.
"""
import json
import os
import re

RULES = [
    (r"^(scalp|forehead|.*temple|face|.*jaw)$", (0.11, 0.02, 0.06)),
    (r"^(cervical|throat|.*neck).*$", (0.08, 0.0, 0.04)),
    (r"^(left|right)_(hand|thumb|fingers|wrist)$", (0.10, 0.06, 0.09)),
    (r"^(left|right)_forearm_(flexor|extensor)$", (0.08, 0.02, 0.03)),
    (r"^(left|right)_elbow$", (0.07, 0.22, 0.05)),
    (r"^(left|right)_knee_.*$", (0.05, 0.18, 0.08)),
    (r"^(left|right)_(heel|foot_arch|toes)$", (0.02, 0.20, 0.07)),
    (r"^(left|right)_(ankle|achilles|shin)$", (0.03, 0.12, 0.03)),
    (r"^(left|right)_(chest|upper_back|oblique|glute|hip_groin)$", (-0.03, -0.02, -0.01)),
    (r"^(mid_back|lumbar_spine|sacrum_si|abdomen_upper|abdomen_lower)$", (-0.035, -0.02, -0.01)),
    (r"^(left|right)_(quadriceps|hamstring|it_band|calf)$", (-0.02, 0.01, 0.0)),
]

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_TS = os.path.join(ROOT, "src", "components", "body", "regions.gen.ts")


def region_names():
    """numericId -> region id string, parsed out of the generated TS table"""
    src = open(_TS, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"id: '([a-z0-9_]+)', numericId: (\d+)", src):
        out[int(m.group(2))] = m.group(1)
    return out


def zone_lut(size=128):
    """(size, 3) float array of (melanin, dryness, vascularity)"""
    import numpy as np

    lut = np.zeros((size, 3), np.float32)
    for num, name in region_names().items():
        if num >= size:
            continue
        for pattern, vals in RULES:
            if re.match(pattern, name):
                lut[num] = vals
                break
    return lut
