"""Deterministic config gate + in-glass hallucination scorer (Phase 4).

The regional composite guarantees structure BY CONSTRUCTION; the finishing AI
pass is the one place the AI touches structure again. This gate makes that safe:
compare the finished render against the guaranteed assembly inside the
structure-minus-glass region using EDGE MAPS — a moved/added/dropped frame line
shows up as edge disagreement, while the texture/grain/tone changes a finish
pass legitimately makes do not. No new deps (PIL + numpy).

Both checks are pure functions of bytes; callers decide policy (retry/fallback).
"""
import io
import logging
import os

import numpy as np
from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)

# Fraction of edge disagreement above which the render is considered drifted.
# Calibrated by the __main__ self-check: identical-plus-noise pairs score ~0.0x,
# a 3px frame shift scores several times the threshold. Env-tunable.
GATE_THRESHOLD = float(os.environ.get("CONFIG_GATE_THRESHOLD", "0.18"))


def _gray(b: bytes, size=None) -> np.ndarray:
    img = Image.open(io.BytesIO(b)).convert("L")
    if size and img.size != size:
        img = img.resize(size, Image.LANCZOS)
    return np.asarray(img).astype(np.float32)


def _edges(gray: np.ndarray, thresh: float = 40.0) -> np.ndarray:
    """Binary strong-edge map via gradient magnitude (Sobel-lite with numpy)."""
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
    mag = np.hypot(gx, gy)
    return mag > thresh


def _dilate(binary: np.ndarray, px: int) -> np.ndarray:
    img = Image.fromarray(binary.astype(np.uint8) * 255)
    return np.asarray(img.filter(ImageFilter.MaxFilter(px * 2 + 1))) > 128


def drift_score(
    final_bytes: bytes,
    reference_bytes: bytes,
    structure_mask_bytes: bytes,
    glass_mask_bytes: bytes | None = None,
) -> float:
    """Edge disagreement between final and reference inside structure-minus-glass.

    0.0 = edges agree perfectly. Score = (reference edges missing from final +
    new strong edges invented by final) / reference edge count, with a 2px
    tolerance so antialiasing and resize jitter don't count as drift.
    """
    ref = Image.open(io.BytesIO(reference_bytes)).convert("L")
    size = ref.size
    r = np.asarray(ref).astype(np.float32)
    f = _gray(final_bytes, size)
    m = _gray(structure_mask_bytes, size) > 128
    if glass_mask_bytes:
        m &= ~(_gray(glass_mask_bytes, size) > 128)
    # keep away from the region boundary so mask-edge artifacts don't score
    m = ~_dilate(~m, 3)

    re = _edges(r) & m
    fe = _edges(f) & m
    n_ref = int(re.sum())
    if n_ref < 200:  # nothing to compare (tiny/absent structure region)
        return 0.0
    missing = re & ~_dilate(fe, 2)
    invented = fe & ~_dilate(re, 2)
    return float((missing.sum() + invented.sum()) / n_ref)


def structure_edge_miss(
    candidate_bytes: bytes, composite_bytes: bytes, structure_mask_bytes: bytes
) -> float:
    """Fraction of the COMPOSITE's structural edges that the candidate LOST.

    The config-fidelity ranker for the over-generate pool. Lower = the render kept
    more of the structure that was drawn. Use it to ORDER candidates, never as an
    absolute threshold — a flat CGI reference against a photograph always scores
    high in absolute terms.

    Why not drift_score: that one excludes glass and erodes the region boundary,
    which is right when comparing two PHOTOREAL images but leaves only featureless
    white frame interiors against a CGI composite — 37 edges on a real case, under
    its own 200 minimum, so it returned 0.0 for every candidate. Every structural
    cue (frame/glass boundaries, door stiles, kneewall band tops, transom sills)
    lives exactly on the boundary drift_score throws away.

    Only MISSING edges count. A render that adds edges — reflections, siding
    texture, shadows — is being photorealistic, not drifting. A render that drops
    the drawn lines has regularized a wall into something else, which is the
    failure this exists to catch, and it is not door-specific: any config the
    model flattens away loses the same kind of edges.

    Validated 2026-08-20 on five renders of a known-hard config (an all-door
    wall): the two that kept the door scored 0.399/0.455, the three that replaced
    it with windows scored 0.580/0.597/0.667 — a clean gap, correct order.
    """
    ref = Image.open(io.BytesIO(composite_bytes)).convert("L")
    size = ref.size
    r = np.asarray(ref).astype(np.float32)
    m = _gray(structure_mask_bytes, size) > 128
    ref_edges = _edges(r) & m
    n_ref = int(ref_edges.sum())
    if n_ref < 200:
        return 0.0
    cand_edges = _edges(_gray(candidate_bytes, size)) & m
    missing = ref_edges & ~_dilate(cand_edges, 2)
    return float(missing.sum() / n_ref)


def gate_passes(final_bytes, reference_bytes, structure_mask_bytes, glass_mask_bytes=None):
    """(ok, score) — ok=False means the finish pass drifted the structure."""
    s = drift_score(final_bytes, reference_bytes, structure_mask_bytes, glass_mask_bytes)
    ok = s <= GATE_THRESHOLD
    if not ok:
        logger.warning(f"config gate FAILED: drift {s:.3f} > {GATE_THRESHOLD}")
    else:
        logger.info(f"config gate ok: drift {s:.3f}")
    return ok, s


def glass_hallucination_score(
    ai_bytes: bytes,
    composite_bytes: bytes,
    glass_mask_bytes: bytes,
) -> float:
    """Density of strong edges the AI INVENTED inside glass panes (a hallucinated
    mid-pane mullion = new interior edges the composite doesn't have). Lower is
    better; use to rank seeds in the overgen pool. Pane interiors only — the
    mask is eroded so legitimate frame-line differences at pane borders and
    reflections' soft gradients (below the edge threshold) don't count."""
    comp = Image.open(io.BytesIO(composite_bytes)).convert("L")
    size = comp.size
    c = np.asarray(comp).astype(np.float32)
    a = _gray(ai_bytes, size)
    g = _gray(glass_mask_bytes, size) > 128
    g = ~_dilate(~g, 4)  # erode: pane interiors only
    if g.sum() < 500:
        return 0.0
    invented = (_edges(a, 60.0) & g) & ~_dilate(_edges(c, 40.0) & g, 3)
    return float(invented.sum() / g.sum())


if __name__ == "__main__":
    # Self-check: a synthetic frame grid. Finish-like noise must PASS the gate;
    # a 3px shifted grid (config drift) must FAIL. Run: python -m app.config_gate
    def png(arr):
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, format="PNG")
        return buf.getvalue()

    W = H = 300
    grid = np.full((H, W), 230, np.uint8)
    for x in range(40, W, 60):
        grid[:, x : x + 6] = 40  # vertical "frames"
    grid[140:148, :] = 40  # a "transom rail"
    mask = np.full((H, W), 255, np.uint8)

    rng = np.random.default_rng(0)
    noisy = np.clip(grid.astype(int) + rng.normal(0, 6, grid.shape), 0, 255).astype(np.uint8)
    shifted = np.roll(grid, 3, axis=1)

    ok_clean, s_clean = gate_passes(png(noisy), png(grid), png(mask))
    ok_drift, s_drift = gate_passes(png(shifted), png(grid), png(mask))
    print(f"clean pair:  drift={s_clean:.3f} ok={ok_clean}")
    print(f"3px shift:   drift={s_drift:.3f} ok={ok_drift}")
    assert ok_clean, "finish-like noise must pass"
    assert not ok_drift, "3px frame shift must fail"

    # Hallucination scorer: one glass pane; AI output that paints reflections
    # (soft gradients) must score ~0, AI output that INVENTS a mullion must not.
    pane_mask = np.zeros((H, W), np.uint8)
    pane_mask[60:240, 60:240] = 255
    comp_glass = np.full((H, W), 90, np.uint8)  # flat dark pane
    yy = np.arange(H).reshape(-1, 1)
    reflections = np.clip(90 + 25 * np.sin(yy / 18.0) + rng.normal(0, 3, (H, W)), 0, 255).astype(np.uint8)
    mullion = comp_glass.copy()
    mullion[:, 148:156] = 235  # invented white bar through the pane
    s_soft = glass_hallucination_score(png(reflections), png(comp_glass), png(pane_mask))
    s_mull = glass_hallucination_score(png(mullion), png(comp_glass), png(pane_mask))
    print(f"reflections: {s_soft:.4f}   invented mullion: {s_mull:.4f}")
    assert s_mull > s_soft * 3 and s_mull > 0.005, "mullion must score far above reflections"
    print("CONFIG GATE SELF-CHECK OK")
