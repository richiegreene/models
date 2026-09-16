/* =====================================================================
 *  HARMONIC ENTROPY — the core the three modes share
 * =====================================================================
 *
 * One statement of the model, written to Pyodide as python/he_core.py and
 * imported by dyads_generator, triads_generator and tetrads_entropy. Each of
 * those does only what is particular to its dimension — which chords are in
 * the basis set and where they land on the grid — and comes here for the
 * weighting, the spreading function, the convolution and the entropy, so that
 * "17 ¢, order 7, Tenney series" means one model whether it is read over one
 * interval, two or three.
 *
 * THE MODEL, as stated on the Xenharmonic Wiki (https://en.xen.wiki/w/Harmonic_entropy)
 * and computed in Mike Battaglia's HE.html (HE-JS) and Sintel's
 * harmonic_entropy_triads.ipynb:
 *
 *   basis set   J   every rational (or chord) under a height bound N —
 *                   Tenney:  n·d ≤ N      (chords: a·b·c… ≤ N)
 *                   Weil:    max(n,d) ≤ N (chords: max(a,b,c…) ≤ N)
 *   weight      ‖j‖ the cell each basis chord owns, which Erlich observed to
 *                   scale as √(nd) under a Tenney bound and max(n,d) under a
 *                   Weil bound. Q(j|c) = S(¢(j) − c) / ‖j‖.
 *   spreading   S   a Gaussian of standard deviation s (about 17 ¢, or 1 % of
 *                   frequency), or the heavier-tailed Laplace ("Vos") curve —
 *                   both members of the generalised normal family.
 *   entropy     HE_a(c) = 1/(1−a) · log Σ_j P(j|c)^a,  P = Q / Σ Q
 *                   a → 1 is Shannon, −Σ P log P; a = 2 collision; a → ∞
 *                   min-entropy, −log max P.
 *
 * COMPUTED BY CONVOLUTION.  Stamp every basis chord onto a grid as a delta of
 * weight 1/‖j‖ (K) and of weight 1/‖j‖^a (K^a); then
 *
 *   ψ(c)   = [S ∗ K](c)             the normaliser Σ_j Q(j|c)
 *   ρ_a(c) = [S^a ∗ K^a](c)         Σ_j Q(j|c)^a
 *   HE_a   = 1/(1−a) · log( ρ_a / ψ^a )
 *
 * which is the wiki's "Convolution-based expression", O(N log N) by FFT. The
 * scale of S drops out of the quotient, so the kernel is never normalised.
 * For a = 1 the same trick gives Shannon exactly rather than as a limit:
 *
 *   Σ_j Q log Q = [S ∗ K_{w log w}] + [(S log S) ∗ K]
 *   H_1 = log ψ − (Σ_j Q log Q) / ψ
 *
 * CHORDS.  A chord of n voices is a point in n−1 intervals, and the spreading
 * function has to say how the EAR's uncertainty spreads over those. The one
 * assumption that generalises the dyad without a new parameter: each voice is
 * independently mistuned by a Gaussian of σᵥ = s/√2, so that every pairwise
 * interval — a difference of two voices — has standard deviation exactly s,
 * the wiki's own s. The intervals d = (c₁, c₂, …) then have covariance
 *
 *   Σ = (s²/2) · D,   D = tridiag(−1, 2, −1)
 *
 * and S(d) = exp(−½ · dᵀ Σ⁻¹ d). For three voices Σ⁻¹ is (2/3s²)[[2,1],[1,2]],
 * which is ISOTROPIC in Sintel's equilateral coordinates x = c₁ + c₂/2,
 * y = c₂√3/2 with σ = s·√3/2 — his std of 15 is s ≈ 17.3 ¢, the canonical 1 %.
 * For four voices it is the anisotropic form the tetrad volume is blurred
 * with; see chord_metric below.
 * ------------------------------------------------------------------ */

export const HE_CORE_PY = `"""Harmonic entropy, the part every mode shares.

See he-python.js for the exposition; this file is the arithmetic. Sources:
  https://en.xen.wiki/w/Harmonic_entropy
  Mike Battaglia, HE-JS (HE.html): the FFT form, s in %, Tenney/Farey series
  Sintel, harmonic_entropy_triads.ipynb
      https://gist.github.com/Sin-tel/8d1a55a0e34ca159ac6aa61e325648d2
"""
import math
import numpy as np


# ---------------------------------------------------------------------
#  FFT convolution, numpy only
# ---------------------------------------------------------------------

def fast_len(n):
    """The smallest 5-smooth integer >= n.

    pocketfft is fast at any length whose factors are 2, 3 and 5, and padding
    to the next power of two — the usual habit — can double a 3D transform for
    nothing: 146 rounds to 256 instead of 150.
    """
    n = max(1, int(n))
    while True:
        m = n
        for p in (2, 3, 5):
            while m % p == 0:
                m //= p
        if m == 1:
            return n
        n += 1


def fftconvolve_same(a, k):
    """scipy.signal.fftconvolve(a, k, mode="same"), in any dimension.

    Multiply in the frequency domain at a size that holds the full linear
    convolution (so nothing wraps), then crop to a's shape centred the way
    scipy centres it.
    """
    a = np.asarray(a, dtype=np.float64)
    k = np.asarray(k, dtype=np.float64)
    full = tuple(sa + sk - 1 for sa, sk in zip(a.shape, k.shape))
    fast = tuple(fast_len(n) for n in full)
    axes = tuple(range(a.ndim))
    out = np.fft.irfftn(np.fft.rfftn(a, fast, axes=axes) * np.fft.rfftn(k, fast, axes=axes),
                        fast, axes=axes)
    crop = tuple(slice((sk - 1) // 2, (sk - 1) // 2 + sa) for sa, sk in zip(a.shape, k.shape))
    return out[crop]


# ---------------------------------------------------------------------
#  The basis set's weights
# ---------------------------------------------------------------------

def height_bound(root, voices, series):
    """The bound N, from the slider's root value.

    The panel asks for a ROOT rather than for N itself, because N is a product
    of as many integers as there are voices: 100 means n*d <= 10 000 for dyads,
    a*b*c <= 1 000 000 for triads. Under a Weil bound the root is the bound —
    max(a, b, ...) <= root.
    """
    root = max(1, int(root))
    return root if series == "weil" else root ** int(voices)


def weights(f, series="tenney"):
    """1/||j|| for every chord in f, an (N, voices) integer array.

    Tenney: 1/sqrt(a*b*c...), the generalisation of 1/sqrt(nd) — Sintel's
    weighting for triads. Weil: 1/max(a, b, c...), the generalisation of
    1/max(n, d). Both are the widths Erlich found the mediant-to-mediant
    domains to have under the matching height bound.
    """
    ff = np.asarray(f, dtype=np.float64)
    if series == "weil":
        return 1.0 / np.max(ff, axis=1)
    return 1.0 / np.sqrt(np.prod(ff, axis=1))


# ---------------------------------------------------------------------
#  The spreading function
# ---------------------------------------------------------------------

def chord_metric(voices):
    """The quadratic form Q with  m^2(d) = d^T Q d / s^2  for a displacement d
    of the chord's successive intervals, in cents.

    Every voice mistuned independently by N(0, s^2/2), so every pairwise
    interval has standard deviation s. The successive intervals then have
    covariance (s^2/2) * D with D = tridiag(-1, 2, -1), and Q = 2 * D^-1:

        dyads    [1]
        triads   (2/3) [[2, 1], [1, 2]]
        tetrads  (1/2) [[3, 2, 1], [2, 4, 2], [1, 2, 3]]
    """
    n = int(voices) - 1
    d = 2.0 * np.eye(n) - np.eye(n, k=1) - np.eye(n, k=-1)
    return 2.0 * np.linalg.inv(d)


def kernel_shape(beta):
    """(alpha, reach) for the generalised normal exp(-(m/alpha)^beta), with
    alpha chosen so the one-dimensional standard deviation is 1 — so that s
    means the same width whichever shape is picked — and reach the m at which
    the kernel has fallen to 1e-5, where it can be cut off.

        beta = 2   Gaussian, alpha = sqrt(2), reach 4.8 sigma
        beta = 1   Laplace ("Vos"), alpha = 1/sqrt(2), reach 8.1 sigma
    """
    b = float(beta)
    alpha = math.sqrt(math.gamma(1.0 / b) / math.gamma(3.0 / b))
    reach = alpha * (math.log(1e5)) ** (1.0 / b)
    return alpha, reach


def spreading_kernel(metric, cell, s_cents, beta=2.0):
    """The spreading function sampled on the grid, as an ndarray.

    metric   the (n, n) form from chord_metric — or (4/3) I for a grid laid
             out in Sintel's equilateral coordinates, where it is isotropic
    cell     cents per grid step along each axis
    s_cents  the spread s, in cents
    beta     2 for Gaussian, 1 for Laplace
    """
    q = np.asarray(metric, dtype=np.float64)
    n = q.shape[0]
    cell = np.broadcast_to(np.asarray(cell, dtype=np.float64), (n,))
    s = max(1e-6, float(s_cents))
    alpha, reach = kernel_shape(beta)
    # Marginal std along each axis: cov = s^2 Q^-1, so sigma_i = s sqrt(Q^-1_ii).
    sig = s * np.sqrt(np.diag(np.linalg.inv(q))) / cell
    half = [max(1, int(math.ceil(reach * v))) for v in sig]
    axes = [np.arange(-h, h + 1, dtype=np.float64) * c for h, c in zip(half, cell)]
    grids = np.meshgrid(*axes, indexing="ij")
    d = np.stack(grids, axis=-1)
    m2 = np.einsum("...i,ij,...j->...", d, q, d) / (s * s)
    m = np.sqrt(np.maximum(m2, 0.0))
    return np.exp(-np.power(m / alpha, float(beta)))


# ---------------------------------------------------------------------
#  Stamping and the entropy
# ---------------------------------------------------------------------

def splat(shape, pos, w, alpha, nearest=False):
    """Stamp weighted deltas onto a grid, in any dimension.

    pos is (N, n) in fractional grid cells. Returns (K, K_a) where K carries w
    and K_a carries w**alpha — or, when alpha == 1, (K, K_wlogw) for the exact
    Shannon path.

    Two ways to put a chord that falls between cells onto the grid, and the
    difference is not cosmetic:

      linear   split between the neighbouring cells by distance — HE-JS's
               interpolation. The chord stays where it is, but a stamp
               represented by two half-stamps has a slightly LOWER entropy
               than one stamp (the power mean of the kernel across a cell is
               above its plain mean), and that bias sits exactly at the
               minima. It is a thousandth of a nat at a one-cent cell and a
               third of a nat at a cell of two thirds of s with a = 7.
      nearest  round to the cell — Sintel's notebook. The entropy is exact
               for the set as stamped and never negative; the chord has moved
               by up to half a cell.

    The line and the triangle have cells far finer than s and use linear; the
    volume cannot, and uses nearest.
    """
    shape = tuple(int(x) for x in shape)
    n = len(shape)
    pos = np.asarray(pos, dtype=np.float64).reshape(-1, n)
    w = np.asarray(w, dtype=np.float64)
    w2 = w * np.log(w) if alpha == 1 else w ** float(alpha)

    size = int(np.prod(shape))
    strides = np.array([int(np.prod(shape[i + 1:])) for i in range(n)], dtype=np.int64)
    k = np.zeros(size, dtype=np.float64)
    k2 = np.zeros(size, dtype=np.float64)

    if nearest:
        idx = np.rint(pos).astype(np.int64)
        inside = np.all((idx >= 0) & (idx < np.array(shape)), axis=1)
        # np.intp for the flat index: Pyodide's numpy is a 32-bit build and
        # bincount refuses int64 there as an unsafe cast.
        flat = (idx[inside] * strides).sum(axis=1).astype(np.intp)
        k += np.bincount(flat, weights=w[inside], minlength=size)
        k2 += np.bincount(flat, weights=w2[inside], minlength=size)
        return k.reshape(shape), k2.reshape(shape)

    lo = np.floor(pos).astype(np.int64)
    fr = pos - lo
    for corner in range(1 << n):
        off = np.array([(corner >> (n - 1 - i)) & 1 for i in range(n)], dtype=np.int64)
        idx = lo + off
        frac = np.prod(np.where(off == 1, fr, 1.0 - fr), axis=1)
        inside = np.all((idx >= 0) & (idx < np.array(shape)), axis=1) & (frac > 0)
        if not inside.any():
            continue
        flat = (idx[inside] * strides).sum(axis=1).astype(np.intp)
        k += np.bincount(flat, weights=w[inside] * frac[inside], minlength=size)
        k2 += np.bincount(flat, weights=w2[inside] * frac[inside], minlength=size)
    return k.reshape(shape), k2.reshape(shape)


def entropy(k, k2, kernel, alpha, support=1e-300):
    """Harmonic Rényi entropy of order alpha over the grid, in nats.

        alpha != 1:  1/(1-a) log( [S^a * K^a] / [S * K]^a )
        alpha == 1:  log psi - ([S * K_wlogw] + [S log S * K]) / psi

    Cells with no basis chord anywhere within the kernel's reach have no
    distribution to take the entropy of, and come back NaN.
    """
    kernel = np.asarray(kernel, dtype=np.float64)
    psi = fftconvolve_same(k, kernel)
    # fftconvolve lands a hair below zero where the truth is zero, and a
    # negative base under a fractional power is a NaN hole in the picture.
    psi = np.maximum(psi, 0.0)
    empty = psi <= support
    if alpha == 1:
        slogs = np.where(kernel > 0, kernel * np.log(np.where(kernel > 0, kernel, 1.0)), 0.0)
        qlogq = fftconvolve_same(k2, kernel) + fftconvolve_same(k, slogs)
        with np.errstate(divide="ignore", invalid="ignore"):
            h = np.log(psi) - qlogq / psi
    else:
        a = float(alpha)
        rho = np.maximum(fftconvolve_same(k2, kernel ** a), 0.0)
        with np.errstate(divide="ignore", invalid="ignore"):
            h = (1.0 / (1.0 - a)) * (np.log(rho) - a * np.log(psi))
    h = np.where(empty, np.nan, h)
    return h


def chord_key(g):
    """One int64 per chord, from its integers — so that the reorderings of a
    chord with a repeated voice (1:1:1:2 has four, not twenty-four) can be
    made unique with np.unique rather than stamped again for every
    permutation that happened to swap two equal numbers."""
    g = np.asarray(g, dtype=np.int64)
    key = np.zeros(g.shape[0], dtype=np.int64)
    for i in range(g.shape[1]):
        key = key * 65536 + g[:, i]
    return key


def chord_unkey(key, voices):
    """chord_key, undone."""
    key = np.asarray(key, dtype=np.int64)
    cols = []
    for i in range(int(voices)):
        cols.append(key % 65536)
        key = key // 65536
    return np.stack(cols[::-1], axis=1)


def finite_range(z, mask=None):
    """(min, max) over the finite values, inside mask if one is given."""
    zz = np.asarray(z)
    if mask is not None:
        zz = zz[mask]
    finite = zz[np.isfinite(zz)]
    if finite.size == 0:
        return 0.0, 1.0
    return float(finite.min()), float(finite.max())
`;
