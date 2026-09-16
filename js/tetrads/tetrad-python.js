/* =====================================================================
 *  TETRADS — the Python behind the volume
 * =====================================================================
 *
 * One thing is asked of Python here: harmonic entropy over the whole
 * tetrahedron, as a volume. The tetrads themselves — which ones exist under
 * the limit, and where they sit — come from tetrahedron_generator.py, written
 * in main.js, exactly as before; this file is only the field.
 *
 * THE GRID.  A tetrad is three successive intervals c₁, c₂, c₃ in cents, each
 * between 0 and the equave E and summing to no more than E — so a chord is a
 * point in the simplex of the unit cube, and the field is computed on a cube
 * of res³ cells over [0,E]³ indexed [c₁][c₂][c₃]. The tetrahedron on screen
 * is that simplex under the barycentric map in three-visualizer.js, and the
 * same three numbers address a voxel, a point on a slice, and a chord.
 *
 * THE BLUR.  Sintel's triangle is an isotropic Gaussian because its equilateral
 * coordinates ARE pitch space's own metric. In three intervals no linear
 * picture is both a regular tetrahedron and isotropic — the vertices of the
 * interval simplex under that metric make a disphenoid, four edges of √3/2·E
 * and two of E — so rather than distort the shape the app has always drawn,
 * the kernel is stated directly in interval coordinates as the anisotropic
 * Gaussian pitch space implies:
 *
 *     S(d) = exp(−½ · dᵀ Σ⁻¹ d),   Σ = (s²/2)·tridiag(−1, 2, −1)
 *
 * which is chord_metric(4) in he_core. Every interval's marginal spread is s
 * and adjacent intervals are anticorrelated by −½, exactly as they are when
 * the shared voice between them moves.
 *
 * THIS REPLACES 4HE/tetrahedron_generator.py, whose kernel was isotropic in
 * these coordinates (so a c₂ mistuning was wider than a c₁ one by √2), whose
 * σ was two GRID CELLS whatever the resolution (so the model changed with the
 * slider), which cut the kernel at 2σ, and which masked out every voxel no
 * chord happened to land in — leaving holes in a field that is, by
 * construction, continuous.
 * ------------------------------------------------------------------ */

export const TETRADS_PY = `import math
import itertools
import numpy as np
from he_core import (
    height_bound, weights, chord_metric, kernel_shape, spreading_kernel,
    splat, entropy, finite_range, chord_key, chord_unkey,
)


def _he_tetrads(eq_hi, root, series="tenney"):
    """The a:b:c:d the entropy is a blur of, as one (N, 4) array, a<=b<=c<=d.

    Tenney series: a*b*c*d <= root**4. Weil series: d <= root. The span is
    taken up to eq_hi — the equave padded by the kernel's reach — so that the
    base of the tetrahedron has neighbours beyond it.

    Two Python loops over a and b; c and d are one vectorised block per pair,
    laid out with np.repeat the way the triangle's generator does it.
    """
    weil = series == "weil"
    N = height_bound(root, 4, series)
    chunks = []
    for a in range(1, int(root) + 1):
        top = int(math.floor(a * eq_hi))
        if weil:
            b_top = min(top, int(root))
        else:
            b_top = min(top, int(round((N / a) ** (1.0 / 3.0))) + 1)
        for b in range(a, b_top + 1):
            if not weil and a * b * b * b > N:
                break
            if weil:
                c_top = min(top, int(root))
            else:
                c_top = min(top, int(math.isqrt(N // (a * b))))
            if c_top < b:
                continue
            c = np.arange(b, c_top + 1, dtype=np.int64)
            if weil:
                d_top = np.full(c.size, min(top, int(root)), dtype=np.int64)
            else:
                d_top = np.minimum(top, N // (a * b * c))
            # np.intp for the counts: Pyodide's numpy is a 32-bit build and
            # repeat() refuses an int64 count array there as an unsafe cast.
            counts = np.maximum(0, d_top - c + 1).astype(np.intp)
            total = int(counts.sum())
            if total == 0:
                continue
            cc = np.repeat(c, counts)
            starts = np.concatenate(([0], np.cumsum(counts)[:-1])).astype(np.int64)
            dd = cc + (np.arange(total, dtype=np.int64) - np.repeat(starts, counts))
            aa = np.full(total, a, dtype=np.int64)
            bb = np.full(total, b, dtype=np.int64)
            keep = np.gcd(np.gcd(aa, bb), np.gcd(cc, dd)) == 1
            if keep.any():
                chunks.append(np.stack([aa[keep], bb[keep], cc[keep], dd[keep]], axis=1))
    if not chunks:
        return np.zeros((0, 4), dtype=np.int64)
    return np.concatenate(chunks)


_PERMS4 = [p for p in itertools.permutations(range(4)) if p != (0, 1, 2, 3)]


def _intervals(g):
    gg = g.astype(np.float64)
    return 1200.0 * np.log2(gg[:, 1:] / gg[:, :-1])


def harmonic_entropy_volume(equave_ratio, res=128, root=60, series="tenney",
                            alpha=4.0, spread_cents=17.0, beta=2.0):
    """Harmonic Renyi entropy over the tetrahedron, in nats.

    Returns the res³ cube over [0,E]³ in c₁, c₂, c₃, as a float32 buffer with
    the range over the simplex, "up" = -1 (a concordance is a trough), the
    size of the basis set and the width of a cell in cents. Cells beyond the
    simplex that are still within the kernel's reach carry their true value —
    the renderer filters across the faces — and cells beyond that are NaN.

    Same arithmetic as the line and the triangle: stamp at 1/||j||, blur, take
    the entropy by FFT. Spread is asked in cents, so the resolution slider
    sharpens the picture rather than changing the model.
    """
    eq = float(equave_ratio)
    R = max(16, int(res))
    E = 1200.0 * math.log2(eq)
    if not (E > 0):
        return None

    cell = E / (R - 1)
    s = float(spread_cents)
    _, reach = kernel_shape(beta)
    pad_cents = reach * s
    pad = int(math.ceil(pad_cents / cell))

    f = _he_tetrads(eq * 2.0 ** (pad_cents / 1200.0), root, series)
    if len(f) == 0:
        return None
    w = weights(f, series)
    c = _intervals(f)

    # Reflected copies for the chords within reach of a face: the other
    # orderings of a:b:c:d, kept where they land inside the padded simplex.
    # Almost all of a chord's 23 images fall far outside and are dropped; the
    # ones that survive are its neighbours across the face it sits against.
    tol = pad_cents / E
    span = c.sum(axis=1)
    near = (c.min(axis=1) <= pad_cents) | (span >= E - pad_cents)
    if near.any():
        fn = f[near]
        keys = []
        for perm in _PERMS4:
            g = fn[:, list(perm)]
            q = _intervals(g)
            bl = 1.0 - q.sum(axis=1) / E
            ok = np.all(q / E >= -tol, axis=1) & (bl >= -tol)
            if ok.any():
                keys.append(chord_key(g[ok]))
        if keys:
            images = chord_unkey(np.unique(np.concatenate(keys)), 4)
            # A reordering that is still sorted is the chord itself — two
            # equal voices swapped — and is already stamped.
            sorted_rows = np.all(images[:, :-1] <= images[:, 1:], axis=1)
            images = images[~sorted_rows]
            if len(images):
                c = np.concatenate([c, _intervals(images)])
                w = np.concatenate([w, weights(np.sort(images, axis=1), series)])

    # Nearest cell, not linear splatting — see splat in he_core: at a cell
    # that is a fair fraction of s, splitting a stamp biases the minima.
    pos = c / cell + pad
    G = R + 2 * pad
    k, k2 = splat((G, G, G), pos, w, alpha, nearest=True)

    kernel = spreading_kernel(chord_metric(4), [cell, cell, cell], s, beta)
    h = entropy(k, k2, kernel, alpha)[pad:pad + R, pad:pad + R, pad:pad + R]

    idx = np.arange(R, dtype=np.float64) / (R - 1)
    simplex = (idx[:, None, None] + idx[None, :, None] + idx[None, None, :]) <= 1.0 + 1e-9
    lo, hi = finite_range(h, simplex)
    z = np.ascontiguousarray(h, dtype=np.float32)
    return {
        "r": int(R), "min": lo, "max": hi, "up": -1, "unit": "nats",
        "count": int(len(f)), "cell": float(cell), "data": z.tobytes(),
    }
`;
