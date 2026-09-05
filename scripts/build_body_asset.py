#!/usr/bin/env python3
"""
Build pipeline for the BodyViewer anatomical asset.

Source: BodyParts3D "Skin" mesh (FMA7163), © The Database Center for Life
Science, CC BY 4.0 — extracted from the ashemag/human-atlas packed chunks.

Outputs:
  public/models/body-male.glb          single-mesh GLB with _REGIONID vertex attribute
  src/components/body/regions.gen.ts   typed region table (labels EN/AR, focus targets, neighbours)
  src/components/body/fallbackShapes.gen.ts  2D projected region polygons for the no-WebGL path
  build/seg-front.png / seg-back.png   segmentation QA renders

Coordinate system of the source mesh: metres, Y-up, +Z anterior, +X anatomical left.
Feet at y=0, height ~1.7194 m.
"""
import json, struct, os, sys, colorsys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("ATLAS_DIR", "/tmp/human-atlas/public/models")
OUT_MODELS = os.path.join(ROOT, "public", "models")
OUT_SRC = os.path.join(ROOT, "src", "components", "body")
OUT_QA = os.path.join(ROOT, "build")
for d in (OUT_MODELS, OUT_SRC, OUT_QA):
    os.makedirs(d, exist_ok=True)

# ---------------------------------------------------------------- load mesh
atlas = json.load(open(os.path.join(SRC, "atlas.json")))
part = next(p for p in atlas["parts"] if p["name"] == "Skin")
buf = open(os.path.join(SRC, f"body-{part['chunk']}.bin"), "rb").read()
vc, ic = part["vertexCount"], part["indexCount"]
POS = np.frombuffer(buf, np.float32, vc * 3, part["positions"]).reshape(-1, 3).copy()
NRM = (np.frombuffer(buf, np.int16, vc * 3, part["normals"]).reshape(-1, 3).astype(np.float32) / 32767.0)
NRM /= np.maximum(np.linalg.norm(NRM, axis=1, keepdims=True), 1e-9)
IDX = np.frombuffer(buf, np.uint32, ic, part["indices"]).copy()
H = float(POS[:, 1].max())
print(f"skin mesh: {vc} verts, {ic//3} tris, height {H:.4f} m")

# ------------------------------------------------- keep outer shell only
# BodyParts3D "Skin" is a closed double shell (outer surface + inner lining
# with inverted normals) plus tiny eyelash fragments. Keep the single largest
# outward-oriented connected component: correct normals, half the payload.
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

_tri = IDX.reshape(-1, 3)
_e = np.concatenate([_tri[:, [0, 1]], _tri[:, [1, 2]], _tri[:, [2, 0]]])
_g = coo_matrix((np.ones(len(_e)), (_e[:, 0], _e[:, 1])), shape=(vc, vc))
_n, _comp = connected_components(_g, directed=False)
_sizes = np.bincount(_comp)
_order = np.argsort(_sizes)[::-1]
_keep_id = None
for cand in _order[:4]:
    m = _comp == cand
    c = POS[m].mean(0)
    d = POS[m] - c
    d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
    if (NRM[m] * d).sum(1).mean() > 0:
        _keep_id = cand
        break
assert _keep_id is not None, "no outward-oriented shell found"
keep = _comp == _keep_id
remap = -np.ones(vc, np.int64)
remap[keep] = np.arange(keep.sum())
POS, NRM = POS[keep], NRM[keep]
tri_keep = keep[_tri].all(axis=1)
IDX = remap[_tri[tri_keep]].reshape(-1).astype(np.uint32)
vc, ic = len(POS), len(IDX)
print(f"outer shell: {vc} verts, {ic//3} tris")

x, y, z = POS[:, 0], POS[:, 1], POS[:, 2]
nx, ny, nz = NRM[:, 0], NRM[:, 1], NRM[:, 2]
H = float(y.max())

# ---------------------------------------------------------------- region defs
# base_id: (label_en, label_ar, group, paired, view)
DEFS = {
    "scalp":            ("Scalp / Crown",            "فروة الرأس",                 "head_neck", False, "both"),
    "forehead":         ("Forehead",                 "الجبهة",                     "head_neck", False, "anterior"),
    "temple":           ("Temple",                   "الصدغ",                      "head_neck", True,  "both"),
    "face":             ("Face (Eyes / Cheek)",      "الوجه",                      "head_neck", False, "anterior"),
    "jaw":              ("Jaw / TMJ",                "الفك والمفصل الصدغي",        "head_neck", True,  "anterior"),
    "throat":           ("Front of Neck (Throat)",   "مقدمة العنق",                "head_neck", False, "anterior"),
    "cervical_upper":   ("Upper Neck (Cervical)",    "أعلى الرقبة",                "head_neck", False, "posterior"),
    "cervical_lower":   ("Lower Neck (Cervical)",    "أسفل الرقبة",                "head_neck", False, "posterior"),
    "trapezius":        ("Trapezius",                "العضلة شبه المنحرفة",         "head_neck", True,  "both"),
    "deltoid_anterior": ("Front Shoulder (Deltoid)", "الكتف الأمامي",              "shoulder_arm", True, "anterior"),
    "deltoid_lateral":  ("Outer Shoulder (Deltoid)", "الكتف الجانبي",              "shoulder_arm", True, "both"),
    "deltoid_posterior":("Rear Shoulder (Deltoid)",  "الكتف الخلفي",               "shoulder_arm", True, "posterior"),
    "rotator_cuff":     ("Shoulder Blade / Rotator Cuff", "الكفة المدورة ولوح الكتف", "shoulder_arm", True, "posterior"),
    "biceps":           ("Biceps (Front Upper Arm)", "العضلة ذات الرأسين",          "shoulder_arm", True, "anterior"),
    "triceps":          ("Triceps (Back Upper Arm)", "العضلة ثلاثية الرؤوس",        "shoulder_arm", True, "posterior"),
    "elbow":            ("Elbow",                    "المرفق",                     "shoulder_arm", True, "both"),
    "forearm_flexor":   ("Inner Forearm (Flexors)",  "باطن الساعد",                "shoulder_arm", True, "anterior"),
    "forearm_extensor": ("Outer Forearm (Extensors)","ظاهر الساعد",                "shoulder_arm", True, "posterior"),
    "wrist":            ("Wrist",                    "المعصم",                     "shoulder_arm", True, "both"),
    "hand":             ("Hand",                     "اليد",                       "shoulder_arm", True, "both"),
    "thumb":            ("Thumb",                    "الإبهام",                    "shoulder_arm", True, "both"),
    "fingers":          ("Fingers",                  "الأصابع",                    "shoulder_arm", True, "both"),
    "chest":            ("Chest (Pectoral)",         "الصدر",                      "trunk", True,  "anterior"),
    "upper_back":       ("Upper Back (Rhomboid)",    "أعلى الظهر",                 "trunk", True,  "posterior"),
    "mid_back":         ("Mid Back (Thoracic)",      "منتصف الظهر",                "trunk", False, "posterior"),
    "lumbar_spine":     ("Lower Back (Lumbar)",      "أسفل الظهر (القَطَنية)",      "trunk", False, "posterior"),
    "oblique":          ("Side / Oblique",           "الخاصرة (المائلة)",          "trunk", True,  "both"),
    "abdomen_upper":    ("Upper Abdomen",            "أعلى البطن",                 "trunk", False, "anterior"),
    "abdomen_lower":    ("Lower Abdomen",            "أسفل البطن",                 "trunk", False, "anterior"),
    "sacrum_si":        ("Sacrum / SI Joint",        "العجز والمفصل العجزي الحرقفي","trunk", False, "posterior"),
    "glute":            ("Glute",                    "العضلة الألوية",             "trunk", True,  "posterior"),
    "hip_groin":        ("Hip / Groin",              "الورك والأربية",             "lower_limb", True, "anterior"),
    "quadriceps":       ("Front Thigh (Quadriceps)", "الفخذ الأمامي",              "lower_limb", True, "anterior"),
    "hamstring":        ("Back Thigh (Hamstring)",   "الفخذ الخلفي",               "lower_limb", True, "posterior"),
    "it_band":          ("Outer Thigh (IT Band)",    "الفخذ الخارجي",              "lower_limb", True, "both"),
    "knee_anterior":    ("Front of Knee",            "مقدمة الركبة",               "lower_limb", True, "anterior"),
    "knee_medial":      ("Inner Knee",               "داخل الركبة",                "lower_limb", True, "both"),
    "knee_lateral":     ("Outer Knee",               "خارج الركبة",                "lower_limb", True, "both"),
    "knee_posterior":   ("Back of Knee",             "خلف الركبة",                 "lower_limb", True, "posterior"),
    "calf":             ("Calf (Gastrocnemius)",     "ربلة الساق",                 "lower_limb", True, "posterior"),
    "shin":             ("Shin (Tibialis)",          "قصبة الساق",                 "lower_limb", True, "anterior"),
    "achilles":         ("Achilles Tendon",          "وتر أخيل",                   "lower_limb", True, "posterior"),
    "ankle":            ("Ankle",                    "الكاحل",                     "lower_limb", True, "both"),
    "heel":             ("Heel",                     "الكعب",                      "lower_limb", True, "posterior"),
    "foot_arch":        ("Foot / Arch",              "قوس القدم",                  "lower_limb", True, "both"),
    "toes":             ("Toes",                     "أصابع القدم",                "lower_limb", True, "anterior"),
}

# Build the flat region list (paired regions get left_/right_ prefix).
regions = []  # (region_id, base, side)
for base, (en, ar, group, paired, view) in DEFS.items():
    if paired:
        regions.append((f"left_{base}", base, "left"))
        regions.append((f"right_{base}", base, "right"))
    else:
        regions.append((base, base, "center"))
RID = {rid: i + 1 for i, (rid, _, _) in enumerate(regions)}  # 0 = unassigned
print(f"{len(regions)} regions")


def rid_of(base, xi):
    """region numeric id for base name given x coordinate (side)."""
    if DEFS[base][3]:
        return RID[("left_" if xi > 0 else "right_") + base]
    return RID[base]


# ---------------------------------------------------------------- classification
# Anatomical landmarks measured from the mesh (see analysis notes).
CROTCH = 0.74
KNEE_LO, KNEE_HI = 0.41, 0.52
ANKLE_LO, ANKLE_HI = 0.055, 0.13
WRIST_LO, WRIST_HI = 0.90, 0.945
ELBOW_LO, ELBOW_HI = 1.09, 1.165
SHOULDER = 1.315
NECK_BASE = 1.415
CHIN = 1.465


def arm_threshold(yy):
    """|x| beyond which a vertex belongs to the free upper limb."""
    if yy < 0.70:
        return 9.9
    if yy < 0.95:
        return 0.19
    if yy < 1.20:
        return 0.172
    if yy < SHOULDER:
        return 0.19
    return 9.9


ARMX = np.array([arm_threshold(v) for v in y])
is_arm = np.abs(x) > ARMX

label = np.zeros(vc, np.int32)

for i in range(vc):
    xi, yi, zi = x[i], y[i], z[i]
    nxi, nyi, nzi = nx[i], ny[i], nz[i]
    ax = abs(xi)
    outer = nxi * np.sign(xi) > 0.55  # normal points away from midline
    inner = nxi * np.sign(xi) < -0.55

    # ---- free upper limb -------------------------------------------------
    if is_arm[i]:
        if yi < 0.78:
            label[i] = rid_of("fingers", xi)
        elif yi < WRIST_LO:
            # hanging hand: thumb points anterior
            if zi > 0.068:
                label[i] = rid_of("thumb", xi)
            else:
                label[i] = rid_of("hand", xi)
        elif yi < WRIST_HI:
            label[i] = rid_of("wrist", xi)
        elif yi < ELBOW_LO:
            label[i] = rid_of("forearm_flexor" if nzi > 0.0 else "forearm_extensor", xi)
        elif yi < ELBOW_HI:
            label[i] = rid_of("elbow", xi)
        elif yi < SHOULDER:
            label[i] = rid_of("biceps" if nzi > 0.05 else "triceps", xi)
        else:
            label[i] = rid_of("deltoid_lateral", xi)
        continue

    # ---- head ------------------------------------------------------------
    if yi >= CHIN:
        if yi > 1.68 or (nzi < -0.25 and yi > 1.56):
            label[i] = RID["scalp"]
        elif yi > 1.615 and nzi > 0.15:
            label[i] = RID["forehead"]
        elif 1.575 < yi <= 1.68 and abs(nxi) > 0.72:
            label[i] = rid_of("temple", xi)
        elif yi > 1.52 and nzi > -0.1:
            label[i] = RID["face"] if yi > 1.53 else rid_of("jaw", xi)
        elif yi > 1.52:
            label[i] = RID["scalp"]
        else:  # 1.465 - 1.52
            if nzi < -0.3:
                label[i] = RID["cervical_upper"]
            else:
                label[i] = rid_of("jaw", xi)
        continue

    # ---- neck ------------------------------------------------------------
    if yi >= NECK_BASE:
        if nzi > 0.15 and ax < 0.09:
            label[i] = RID["throat"]
        elif yi > 1.45 and ax < 0.09:
            label[i] = RID["cervical_upper"] if yi > 1.47 else RID["cervical_lower"]
        elif ax < 0.075 and nzi <= 0.15:
            label[i] = RID["cervical_lower"] if yi < 1.47 else RID["cervical_upper"]
        else:
            label[i] = rid_of("trapezius", xi)
        continue

    # ---- shoulder girdle / traps band -------------------------------------
    if yi >= SHOULDER:
        if ax > 0.13:
            if nzi > 0.35:
                label[i] = rid_of("deltoid_anterior", xi)
            elif nzi < -0.35:
                label[i] = rid_of("deltoid_posterior", xi)
            else:
                label[i] = rid_of("deltoid_lateral", xi)
        elif nzi > 0.15:
            label[i] = rid_of("chest", xi) if yi < 1.40 else RID["throat"]
        else:
            label[i] = rid_of("trapezius", xi)
        continue

    # ---- trunk -----------------------------------------------------------
    # posterior spine landmarks for the 1.72 m scan:
    #  C7 ~1.45 | T12 ~1.12 | L5/S1 ~0.98 | sacrum 0.84-0.98 | fold ~0.76
    if yi >= CROTCH:
        front = nzi > 0.2
        back = nzi < -0.2
        if front:
            if yi >= 1.16:
                label[i] = rid_of("chest", xi)
            elif yi >= 1.02:
                label[i] = RID["abdomen_upper"] if ax < 0.115 else rid_of("oblique", xi)
            elif yi >= 0.86:
                label[i] = RID["abdomen_lower"] if ax < 0.125 else rid_of("hip_groin", xi)
            else:
                label[i] = rid_of("hip_groin", xi)
        elif back:
            if yi >= 1.22:
                if ax > 0.065:
                    label[i] = rid_of("rotator_cuff", xi)
                else:
                    label[i] = rid_of("upper_back", xi)
            elif yi >= 1.10:
                label[i] = RID["mid_back"] if ax < 0.15 else rid_of("oblique", xi)
            elif yi >= 0.97:
                label[i] = RID["lumbar_spine"] if ax < 0.13 else rid_of("oblique", xi)
            elif yi >= 0.84:
                label[i] = RID["sacrum_si"] if ax < 0.065 else rid_of("glute", xi)
            else:
                label[i] = rid_of("glute", xi)
        else:  # lateral wall
            if yi >= 1.16:
                label[i] = rid_of("chest", xi) if nzi > 0 else (
                    rid_of("rotator_cuff", xi) if yi > 1.22 else RID["mid_back"])
            elif yi >= 0.92:
                label[i] = rid_of("oblique", xi)
            else:
                label[i] = rid_of("hip_groin", xi) if nzi >= -0.1 else rid_of("glute", xi)
        continue

    # ---- lower limb --------------------------------------------------------
    if yi >= KNEE_HI:  # thigh
        if yi > 0.71 and nzi < -0.25:
            label[i] = rid_of("hamstring", xi)
        elif outer and abs(nzi) < 0.6 and yi > 0.50:
            label[i] = rid_of("it_band", xi)
        elif nzi < -0.25:
            label[i] = rid_of("hamstring", xi)
        else:
            label[i] = rid_of("quadriceps", xi)
        continue
    if yi >= KNEE_LO:  # knee
        if nzi > 0.35:
            label[i] = rid_of("knee_anterior", xi)
        elif nzi < -0.35:
            label[i] = rid_of("knee_posterior", xi)
        elif outer:
            label[i] = rid_of("knee_lateral", xi)
        elif inner:
            label[i] = rid_of("knee_medial", xi)
        else:
            label[i] = rid_of("knee_anterior", xi) if nzi >= 0 else rid_of("knee_posterior", xi)
        continue
    if yi >= ANKLE_HI:  # lower leg
        label[i] = rid_of("shin", xi) if nzi > 0.0 else rid_of("calf", xi)
        continue
    if yi >= ANKLE_LO and zi < 0.055:  # ankle / achilles band
        if nzi < -0.35 and zi < -0.02:
            label[i] = rid_of("achilles", xi)
        else:
            label[i] = rid_of("ankle", xi)
        continue
    # foot
    if zi < -0.028 and yi < 0.075:
        label[i] = rid_of("heel", xi)
    elif zi > 0.093:
        label[i] = rid_of("toes", xi)
    else:
        label[i] = rid_of("foot_arch", xi)

assert (label > 0).all()

# ---------------------------------------------------------------- smoothing
# Majority-filter on the mesh graph to clean ragged boundaries and islands.
print("smoothing labels on mesh graph...")
tri = IDX.reshape(-1, 3)
edges = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
edges = np.unique(np.sort(edges, axis=1), axis=0)
adj = [[] for _ in range(vc)]
for a, b in edges:
    adj[a].append(int(b))
    adj[b].append(int(a))

for it in range(4):
    changed = 0
    new = label.copy()
    for i in range(vc):
        nb = adj[i]
        if not nb:
            continue
        counts = {}
        for j in nb:
            counts[label[j]] = counts.get(label[j], 0) + 1
        own = counts.get(label[i], 0)
        best, bestc = label[i], own
        for k, c in counts.items():
            if c > bestc + 1:  # strict majority beats own label
                best, bestc = k, c
        if best != label[i]:
            new[i] = best
            changed += 1
    label = new
    print(f"  pass {it+1}: {changed} vertices relabelled")
    if changed == 0:
        break

# ---------------------------------------------------------------- region metadata
present = sorted(set(label.tolist()))
id2key = {v: k for k, v in RID.items()}
meta = {}
for rid_num in present:
    m = label == rid_num
    pts = POS[m]
    c = pts.mean(0)
    r = float(np.sqrt(((pts - c) ** 2).sum(1)).max())
    meta[rid_num] = {"centroid": c.tolist(), "radius": r, "count": int(m.sum())}

# neighbours from label adjacency
nbr = {r: set() for r in present}
la, lb = label[edges[:, 0]], label[edges[:, 1]]
diff = la != lb
for a, b in zip(la[diff].tolist(), lb[diff].tolist()):
    nbr[a].add(b)
    nbr[b].add(a)

# ---------------------------------------------------------------- thickness bake
# Approximate local slab thickness: for each vertex, distance to the nearest
# opposite-facing vertex roughly along the inward normal. Thin features
# (ears, fingers, nose, toes) get low values and drive the SSS glow.
print("baking thickness...")
from scipy.spatial import cKDTree

tree = cKDTree(POS)
THICK = np.full(vc, 0.18, np.float32)
pairs = tree.query_ball_point(POS, r=0.14, workers=-1)
for i in range(vc):
    cand = np.array(pairs[i])
    if len(cand) < 2:
        continue
    dvec = POS[cand] - POS[i]
    dist = np.linalg.norm(dvec, axis=1)
    ok = dist > 1e-6
    cand, dvec, dist = cand[ok], dvec[ok], dist[ok]
    dirs = dvec / dist[:, None]
    # candidate must lie roughly along -normal and face back toward us;
    # ignore near-coincident surfaces (mesh folds, armpits) which would
    # otherwise produce spurious near-zero thickness → bright SSS dots
    along = dirs @ (-NRM[i])
    facing = (NRM[cand] * NRM[i]).sum(1)
    sel = (along > 0.7) & (facing < -0.35) & (dist > 0.006)
    if sel.any():
        THICK[i] = dist[sel].min()
THICK = np.clip(THICK, 0.008, 0.18)
# strong smoothing over the mesh graph kills single-vertex outliers
for _ in range(6):
    acc = THICK.copy()
    cnt = np.ones(vc, np.float32)
    for a, b in edges:
        acc[a] += THICK[b]; cnt[a] += 1
        acc[b] += THICK[a]; cnt[b] += 1
    THICK = acc / cnt
print(f"thickness range {THICK.min():.4f}..{THICK.max():.4f} m")

# ---------------------------------------------------------------- female morph
def smoothstep(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def female_variant(P):
    """Smooth regional reshaping of the male anatomical scan into female
    proportions (narrower shoulders/waist, wider hips, softer jaw, chest).
    A stand-in until a licensed female scan is dropped in — see ASSET-SPEC.md."""
    P = P.copy()
    px, py, pz = P[:, 0], P[:, 1], P[:, 2]
    r_id = label  # region labels, used to keep hands/feet unscaled

    # global: slightly shorter and slighter
    P *= np.array([0.945, 0.955, 0.945], np.float32)
    px, py, pz = P[:, 0], P[:, 1], P[:, 2]

    torso = (np.abs(px) < 0.30)
    # shoulder narrowing (y 1.2..1.45), fades out down the arm is fine —
    # arms hang so we scale x toward the midline with a y-window weight
    w_sh = smoothstep(1.14, 1.30, py) * (1 - smoothstep(1.38, 1.48, py))
    P[:, 0] *= 1 - 0.10 * w_sh
    # waist pinch (y 0.95..1.12)
    w_wa = smoothstep(0.90, 1.00, py) * (1 - smoothstep(1.06, 1.16, py))
    inner = np.abs(px) < 0.165
    P[inner, 0] *= (1 - 0.11 * w_wa[inner])
    P[inner, 2] = np.where(
        pz[inner] < 0, pz[inner] * (1 - 0.05 * w_wa[inner]), pz[inner] * (1 - 0.07 * w_wa[inner]))
    # hip / glute widening (y 0.70..0.92)
    w_hip = smoothstep(0.62, 0.76, py) * (1 - smoothstep(0.88, 0.99, py))
    P[inner, 0] *= (1 + 0.085 * w_hip[inner])
    back = inner & (pz < -0.01)
    P[back, 2] *= (1 + 0.10 * w_hip[back])
    # thigh fullness
    w_th = smoothstep(0.42, 0.55, py) * (1 - smoothstep(0.68, 0.80, py))
    P[inner, 0] = np.where(
        np.abs(P[inner, 0]) > 0.01,
        P[inner, 0] * (1 + 0.04 * w_th[inner]),
        P[inner, 0])
    # chest (y 1.22..1.34, front)
    w_ch = smoothstep(1.17, 1.235, py) * (1 - smoothstep(1.30, 1.36, py))
    frontc = (pz > 0.02) & (np.abs(px) > 0.018) & (np.abs(px) < 0.13)
    bump = w_ch * smoothstep(0.018, 0.075, np.abs(px)) * (1 - smoothstep(0.095, 0.135, np.abs(px)))
    P[frontc, 2] += 0.032 * bump[frontc]
    # neutralise the male genital protrusion. The dangling cluster is thin
    # (baked thickness < 0.08 m) while the surrounding pelvis/thighs are
    # thick, which isolates it cleanly; collapse it toward a pubic anchor.
    # continuous, protrusion-weighted collapse toward a pubic anchor:
    # weight grows smoothly with how far the vertex protrudes (z) and how
    # central it is, so base vertices barely move → no stretched triangles
    zone = (np.abs(px) < 0.10) & (py > 0.50) & (py < 0.82) & (pz > 0.02)
    if zone.any():
        anchor = np.array([0.0, 0.775, 0.046], np.float32)
        w_prot = smoothstep(0.028, 0.046, pz[zone])          # how far it sticks out
        w_mid = 1 - smoothstep(0.045, 0.095, np.abs(px[zone]))  # centrality
        w_top = 1 - smoothstep(0.765, 0.82, py[zone])        # fade into abdomen
        w_low = smoothstep(0.50, 0.56, py[zone])             # fade into thighs
        k = (0.99 * w_prot * w_mid * w_top * w_low)[:, None]
        P[zone] = P[zone] * (1 - k) + anchor * k
        # smooth the collapsed patch a little over the mesh graph
        moved = np.zeros(len(P), bool)
        moved[np.where(zone)[0][(k[:, 0] > 0.15)]] = True
        for _ in range(3):
            Q = P.copy()
            for i0 in np.where(moved)[0]:
                nbs = adj[i0]
                if nbs:
                    Q[i0] = 0.4 * P[i0] + 0.6 * P[nbs].mean(0)
            P = Q
    # softer jaw / slightly smaller head
    w_hd = smoothstep(1.40, 1.47, py)
    head_c = np.array([0, 1.545, 0.01], np.float32)
    hm = w_hd > 0
    P[hm] = head_c + (P[hm] - head_c) * (1 - 0.045 * w_hd[hm, None])
    # re-plant feet on the floor
    P[:, 1] -= P[:, 1].min()
    return P


POS_F = female_variant(POS)

# recompute female normals from the morphed geometry (area-weighted)
def vertex_normals(P, I):
    t = I.reshape(-1, 3)
    fn = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, t[:, k], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    return N.astype(np.float32)

NRM_F = vertex_normals(POS_F, IDX)

# ---------------------------------------------------------------- write GLB
def write_glb(path, positions=None, normals=None):
    pos = (POS if positions is None else positions).astype(np.float32)
    nrm = (NRM if normals is None else normals).astype(np.float32)
    reg = label.astype(np.float32)
    idx = IDX.astype(np.uint32)

    def pad(b, n=4, fill=b"\x00"):
        return b + fill * ((n - len(b) % n) % n)

    bufparts, views, accessors = [], [], []
    offset = 0

    def add(arr, target, comp_type, type_str, count, minmax=False):
        nonlocal offset
        raw = pad(arr.tobytes())
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": target})
        acc = {"bufferView": len(views) - 1, "componentType": comp_type, "count": count, "type": type_str}
        if minmax:
            acc["min"] = arr.reshape(count, -1).min(0).tolist()
            acc["max"] = arr.reshape(count, -1).max(0).tolist()
        accessors.append(acc)
        bufparts.append(raw)
        offset += len(raw)
        return len(accessors) - 1

    a_pos = add(pos, 34962, 5126, "VEC3", vc, minmax=True)
    a_nrm = add(nrm, 34962, 5126, "VEC3", vc)
    a_reg = add(reg, 34962, 5126, "SCALAR", vc)
    a_thk = add(THICK.astype(np.float32), 34962, 5126, "SCALAR", vc)
    a_idx = add(idx, 34963, 5125, "SCALAR", ic)

    gltf = {
        "asset": {"version": "2.0", "generator": "build_body_asset.py",
                  "copyright": "BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "Body"}],
        "meshes": [{"name": "Skin", "primitives": [{
            "attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "_REGIONID": a_reg, "_THICKNESS": a_thk},
            "indices": a_idx, "material": 0, "mode": 4}]}],
        "materials": [{"name": "Skin", "pbrMetallicRoughness": {
            "baseColorFactor": [0.788, 0.60, 0.494, 1.0], "metallicFactor": 0.0, "roughnessFactor": 0.55}}],
        "buffers": [{"byteLength": offset}],
        "bufferViews": views,
        "accessors": accessors,
    }
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), fill=b" ")
    bin_chunk = pad(b"".join(bufparts))
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bin_chunk), 0x004E4942))
        f.write(bin_chunk)
    print(f"wrote {path} ({total/1e6:.2f} MB)")


write_glb(os.path.join(OUT_MODELS, "body-male.glb"))
write_glb(os.path.join(OUT_MODELS, "body-female.glb"), POS_F, NRM_F)

# ---------------------------------------------------------------- regions.gen.ts
def mask_color(n):
    return [n & 255, (n >> 8) & 255, 0]

lines = [
    "// AUTO-GENERATED by scripts/build_body_asset.py — do not edit by hand.",
    "import type { BodyRegion } from './types';",
    "",
    "export const REGIONS: BodyRegion[] = [",
]
for rid_str, base, side in regions:
    n = RID[rid_str]
    if n not in meta:
        continue
    en, ar, group, paired, view = DEFS[base]
    lab = en if not paired else (("Left " if side == "left" else "Right ") + en)
    lab_ar = ar if not paired else (ar + (" (يسار)" if side == "left" else " (يمين)"))
    m = meta[n]
    c = m["centroid"]
    dist = float(np.clip(m["radius"] * 3.0 + 0.28, 0.5, 1.4))
    nbs = [f"'{id2key[k]}'" for k in sorted(nbr.get(n, set()))]
    lines.append("  {")
    lines.append(f"    id: '{rid_str}', numericId: {n}, maskColor: [{', '.join(map(str, mask_color(n)))}],")
    lines.append(f"    label: {json.dumps(lab)}, labelAr: {json.dumps(lab_ar, ensure_ascii=False)},")
    lines.append(f"    side: '{side}', view: '{view}', group: '{group}',")
    lines.append(f"    focusTarget: [{c[0]:.4f}, {c[1]:.4f}, {c[2]:.4f}], focusDistance: {dist:.3f},")
    lines.append(f"    neighbours: [{', '.join(nbs)}],")
    lines.append("  },")
lines.append("];")
lines.append("")
lines.append("export const REGION_BY_NUMERIC: Record<number, BodyRegion> = Object.fromEntries(")
lines.append("  REGIONS.map((r) => [r.numericId, r]),")
lines.append(");")
lines.append("export const REGION_BY_ID: Record<string, BodyRegion> = Object.fromEntries(")
lines.append("  REGIONS.map((r) => [r.id, r]),")
lines.append(");")
lines.append("")
open(os.path.join(OUT_SRC, "regions.gen.ts"), "w").write("\n".join(lines))
print("wrote regions.gen.ts")

# ---------------------------------------------------------------- 2D fallback polygons
# Project front-facing / back-facing vertices per region, take convex hulls.
from scipy.spatial import ConvexHull

def hull_poly(mask):
    pts = POS[mask]
    if len(pts) < 8:
        return None
    p2 = np.stack([pts[:, 0], pts[:, 1]], 1)
    try:
        h = ConvexHull(p2)
    except Exception:
        return None
    poly = p2[h.vertices]
    return [[round(float(a), 4), round(float(b), 4)] for a, b in poly]

fb = {"anterior": [], "posterior": []}
for rid_str, base, side in regions:
    n = RID[rid_str]
    if n not in meta:
        continue
    m = label == n
    front = hull_poly(m & (nz > -0.05))
    back = hull_poly(m & (nz < 0.05))
    view = DEFS[base][4]
    if view in ("anterior", "both") and front:
        fb["anterior"].append({"id": rid_str, "points": front})
    if view in ("posterior", "both") and back:
        # mirror x for the posterior view (viewer looks at the back)
        fb["posterior"].append({"id": rid_str, "points": [[-a, b] for a, b in back]})

ts = [
    "// AUTO-GENERATED by scripts/build_body_asset.py — do not edit by hand.",
    "export type FallbackShape = { id: string; points: [number, number][] };",
    f"export const FALLBACK_HEIGHT = {H:.4f};",
    "export const FALLBACK_SHAPES: { anterior: FallbackShape[]; posterior: FallbackShape[] } = ",
    json.dumps(fb, separators=(",", ":")) + ";",
    "",
]
open(os.path.join(OUT_SRC, "fallbackShapes.gen.ts"), "w").write("\n".join(ts))
print("wrote fallbackShapes.gen.ts")

# ---------------------------------------------------------------- QA renders
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rng = np.random.default_rng(7)
palette = {}
for n in present:
    hgo = rng.random()
    palette[n] = colorsys.hsv_to_rgb(hgo, 0.65 + 0.3 * rng.random(), 0.75 + 0.25 * rng.random())
cols = np.array([palette[l] for l in label])

for name, m, flip in (("front", nz > 0.05, 1), ("back", nz < -0.05, -1)):
    fig, axp = plt.subplots(figsize=(7, 14), dpi=110)
    axp.scatter(flip * x[m], y[m], s=1.2, c=cols[m], linewidths=0)
    for n in present:
        mm = (label == n) & m
        if mm.sum() < 25:
            continue
        cxx, cyy = flip * x[mm].mean(), y[mm].mean()
        axp.text(cxx, cyy, id2key[n].replace("left_", "L ").replace("right_", "R "),
                 fontsize=4.2, ha="center", va="center", color="black")
    axp.set_aspect("equal")
    axp.set_title(f"segmentation {name}")
    axp.axis("off")
    fig.savefig(os.path.join(OUT_QA, f"seg-{name}.png"), bbox_inches="tight")
    plt.close(fig)
print("wrote QA renders build/seg-front.png, build/seg-back.png")
