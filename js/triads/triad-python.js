/* =====================================================================
 *  TRIADS — the Python behind the triangle
 * =====================================================================
 *
 * Three things are asked of Python in Triads mode, and they are asked here so
 * that main.js writes one file and the rest of the app never touches a source
 * string again:
 *
 *   generate_triads        which triads exist at all, under the same limit,
 *                          equave and complexity settings the tetrahedron is
 *                          built from — theory/calculations.py is imported
 *                          rather than reimplemented, so a limit means the
 *                          same thing in both modes.
 *   harmonic_entropy_grid  Isoharmonics' harmonic entropy, on the triangle.
 *   sethares_grid          Isoharmonics' Sethares dissonance, on the triangle.
 *
 * WHAT CHANGED FROM ISOHARMONICS.  That app draws its models with matplotlib
 * and hands back a picture. A picture cannot be recoloured, contoured, lifted
 * into 3D or exported as vectors without being generated again, so nothing
 * here draws: each model returns the raw field over a fixed grid and the
 * colouring is done in JS by the app's own colormaps. The two triple loops
 * that built those fields are vectorised for the same reason — they run in
 * Pyodide on the page's own thread, where nine million interpreted iterations
 * is not a wait, it is a hang.
 *
 * THE GRID, WHICH BOTH MODELS SHARE.  An upward equilateral triangle whose
 * bottom-left corner is the unison. Writing the two intervals of the triad as
 * c1 (lower) and c2 (upper), both in cents:
 *
 *     x = c1 + c2/2        y = c2·√3/2        0 ≤ c1 + c2 ≤ E
 *
 * with E the equave in cents. So bottom-left is 1:1:1, bottom-right is the
 * whole equave in the lower interval, and the apex is the whole equave in the
 * upper one. Row 0 of the returned array is y = 0; JS flips it when drawing,
 * and the same three numbers address a pixel, a mesh vertex and a chord.
 * ------------------------------------------------------------------ */

export const TRIADS_PY = `import math
import numpy as np
from fractions import Fraction
from itertools import combinations_with_replacement
from theory.calculations import (
    get_odd_limit, get_integer_limit, check_prime_limit, parse_primes,
    _generate_valid_numbers, calculate_complexity, cents, gcd,
    get_virtual_fundamental_denominator,
)


def generate_triads(limit_value, equave_ratio, limit_mode="odd", max_exponent=3,
                    complexity_measure="Tenney", hide_unison_voices=False,
                    omit_octaves=False, virtual_fundamental_filter=None):
    """Every JI triad inside the equave, as (c1, c2, "i:j:k", complexity).

    The tetrahedron's generator with one voice taken away: the same valid
    numbers, the same filters, the same per-interval limit test, and the same
    complexity taken as the worst of the intervals. Kept as one pass returning
    coordinates and label together — the tetrad path runs two and matches them
    back up by rounding the cents to two places, which is a join that can miss.
    """
    out = []
    eq = float(equave_ratio)

    valid_numbers = _generate_valid_numbers(limit_value, limit_mode, max_exponent, eq)
    if not valid_numbers:
        return []
    nums = sorted(list(valid_numbers))
    primes = parse_primes(limit_value) if limit_mode == "prime" else []

    for combo in combinations_with_replacement(nums, 3):
        i, j, k = combo
        if i == 0:
            continue
        if hide_unison_voices and len(set(combo)) < 3:
            continue
        if k / i > eq:
            continue
        if gcd(gcd(i, j), k) != 1:
            continue

        if omit_octaves:
            has_octave = False
            for a in range(3):
                for b in range(a + 1, 3):
                    r = combo[b] / combo[a]
                    if r > 1 and math.isclose(math.log2(r), round(math.log2(r))):
                        has_octave = True
                        break
                if has_octave:
                    break
            if has_octave:
                continue

        if virtual_fundamental_filter:
            vf = get_virtual_fundamental_denominator(combo)
            if vf is None or vf not in virtual_fundamental_filter:
                continue

        intervals = [Fraction(j, i), Fraction(k, j)]
        ok = True
        if limit_mode == "odd":
            lv = int(limit_value)
            ok = all(get_odd_limit(x) <= lv for x in intervals)
        elif limit_mode == "integer":
            lv = int(limit_value)
            ok = all(get_integer_limit(x) <= lv for x in intervals)
        elif limit_mode == "prime":
            ok = all(check_prime_limit(x, primes, int(max_exponent)) for x in intervals)
        if not ok:
            continue

        complexity = max(calculate_complexity(complexity_measure, x) for x in intervals)
        out.append((cents(j / i), cents(k / j), "%d:%d:%d" % (i, j, k), complexity))

    return out


def _fftconvolve_same(a, k):
    """scipy.signal.fftconvolve(a, k, mode="same"), in numpy alone.

    scipy was 48 MB of the page's first load and this and the resampling in
    sethares_grid were all it was used for. Same arithmetic: multiply in the
    frequency domain at a size that holds the full convolution, then crop to
    a's shape, centred the way scipy centres it. Padded to a power of two so
    the transform is never asked for an awkward length.
    """
    full = tuple(sa + sk - 1 for sa, sk in zip(a.shape, k.shape))
    fast = tuple(1 << (n - 1).bit_length() for n in full)
    if a.ndim == 1:
        out = np.fft.irfft(np.fft.rfft(a, fast[0]) * np.fft.rfft(k, fast[0]), fast[0])
    else:
        out = np.fft.irfft2(np.fft.rfft2(a, fast) * np.fft.rfft2(k, fast), fast)
    crop = tuple(slice((sk - 1) // 2, (sk - 1) // 2 + sa) for sa, sk in zip(a.shape, k.shape))
    return out[crop]


def _grid_shape(width):
    """The equilateral grid: y spans E·√3/2 where x spans E."""
    width = max(8, int(width))
    return width, max(8, int(round(width * math.sqrt(3) / 2.0)))


def _triangle_mask(width, height):
    """True inside the upward triangle (0,0)–(w-1,0)–((w-1)/2, h-1)."""
    xs = np.arange(width)[None, :]
    ys = np.arange(height)[:, None]
    slope = 2.0 * (height - 1) / (width - 1)
    return (ys >= 0) & (ys <= slope * xs + 1e-9) & (ys <= slope * ((width - 1) - xs) + 1e-9)


def _pack(z):
    """A field, as the flat float32 buffer JS reads it back from.

    tolist() on a 420x364 grid is 150,000 Python floats crossing the bridge one
    object at a time; the buffer is one copy. NaN marks outside the triangle
    and survives the round trip, which is what the renderers test for.
    """
    z = np.asarray(z, dtype=np.float32)
    finite = z[np.isfinite(z)]
    lo = float(finite.min()) if finite.size else 0.0
    hi = float(finite.max()) if finite.size else 1.0
    return {
        "w": int(z.shape[1]),
        "h": int(z.shape[0]),
        "min": lo,
        "max": hi,
        "data": z.tobytes(),
    }


def _he_triads(eq, n_limit, c_limit):
    """The i:j:k the entropy is a blur of, as one (N, 3) array.

    Isoharmonics builds this with three nested Python loops — about nine
    million iterations at n_limit 300, each doing a gcd. Here the inner two
    are one vectorised block per i: j runs over its range, each j gets its own
    count of k, and np.repeat lays them out flat.
    """
    chunks = []
    for i in range(1, int(n_limit)):
        j_top = min(int(math.floor(i * eq)), c_limit // i)
        if j_top < i:
            continue
        j = np.arange(i, j_top + 1, dtype=np.int64)
        k_top = np.minimum(int(math.floor(i * eq)), c_limit // (i * j))
        # np.intp, not int64: Pyodide's numpy is a 32-bit build, and repeat()
        # refuses an int64 count array there as an unsafe cast. Everything else
        # stays int64 — i·j·k reaches 27 million and must not wrap.
        counts = np.maximum(0, k_top - j + 1).astype(np.intp)
        total = int(counts.sum())
        if total == 0:
            continue
        jj = np.repeat(j, counts)
        starts = np.concatenate(([0], np.cumsum(counts)[:-1])).astype(np.int64)
        kk = jj + (np.arange(total, dtype=np.int64) - np.repeat(starts, counts))
        ii = np.full(total, i, dtype=np.int64)
        keep = (np.gcd(np.gcd(ii, jj), kk) == 1) & (ii * jj * kk < c_limit)
        if keep.any():
            chunks.append(np.stack([ii[keep], jj[keep], kk[keep]], axis=1))
    if not chunks:
        return np.zeros((0, 3), dtype=np.int64)
    return np.concatenate(chunks)


def harmonic_entropy_grid(equave_ratio, width=420, n_limit=300, c_limit=27000000,
                          alpha=7.0, spread_cents=30.0):
    """Renyi harmonic entropy over the triangle — Isoharmonics' model, undrawn.

    Every triad inside the equave is stamped at its point with weight
    1/sqrt(ijk), the field is blurred, and the Renyi entropy of the blur is
    taken. High where the ear has many simple readings of the same sonority to
    choose between, low where one reading dominates. Returned as 7 - H so that
    a concordance is a peak, which is the shape the 3D view lifts.

    Spread is asked in CENTS rather than in pixels, so a resolution change
    sharpens the picture instead of changing the model.
    """
    eq = float(equave_ratio)
    width, height = _grid_shape(width)
    max_cents = 1200.0 * math.log2(eq)
    if not (max_cents > 0):
        return None

    f = _he_triads(eq, n_limit, int(c_limit))
    if len(f) == 0:
        return None

    ff = f.astype(np.float64)
    w = 1.0 / np.sqrt(np.prod(ff, axis=1))
    c1 = 1200.0 * np.log2(ff[:, 1] / ff[:, 0])
    c2 = 1200.0 * np.log2(ff[:, 2] / ff[:, 1])

    px = np.round(((c1 + c2 / 2.0) / max_cents) * (width - 1)).astype(np.int64)
    py = np.round((c2 / max_cents) * (height - 1)).astype(np.int64)
    inside = (px >= 0) & (px < width) & (py >= 0) & (py < height)
    px, py, w = px[inside], py[inside], w[inside]
    if px.size == 0:
        return None

    k = np.zeros((height, width), dtype=np.float64)
    k_a = np.zeros((height, width), dtype=np.float64)
    np.add.at(k, (py, px), w)
    np.add.at(k_a, (py, px), w ** alpha)

    std = max(1.0, (float(spread_cents) / max_cents) * width)
    reach = int(round(std * 4))
    axis = np.arange(-reach, reach + 1)
    xv, yv = np.meshgrid(axis, axis)
    s = np.exp(-((xv ** 2 + yv ** 2) / (2.0 * std ** 2)))

    # FFT convolution rather than direct: the kernel is a few hundred pixels
    # across at the resolutions this is asked at, and direct convolution of two
    # squares that size is minutes rather than seconds.
    p_k = _fftconvolve_same(k, s)
    p_ka = _fftconvolve_same(k_a, s ** alpha)

    eps = 1e-16
    # fftconvolve can land a hair below zero where the true value is zero, and
    # a negative base under a fractional power is a NaN hole in the picture.
    p_k = np.maximum(p_k, 0.0)
    p_ka = np.maximum(p_ka, 0.0)
    entropy = (1.0 / (1.0 - alpha)) * np.log((eps + p_ka) / (eps + p_k ** alpha))

    z = 7.0 - entropy
    z[~_triangle_mask(width, height)] = np.nan
    return _pack(z)


def _dissonance(f1, f2, l1, l2):
    """Plomp-Levelt as Sethares parameterises it, over arrays."""
    fmin = np.minimum(f1, f2)
    fmax = np.maximum(f1, f2)
    s = 0.24 / (0.0207 * fmin + 18.96)
    p = s * (fmax - fmin)
    return np.minimum(l1, l2) * (np.exp(-3.51 * p) - np.exp(-5.75 * p))


def sethares_grid(spectrum_freq, spectrum_amp, ref_freq, equave_ratio,
                  step_size=0.02, width=420, z_ramp=1.0, spread_cents=20.0):
    """Sensory dissonance of the triad 1 : r : s, over the triangle.

    Isoharmonics walks the r/s grid in Python and sums over every pair of
    partials inside it — the grid is the inner loop there, and it is the outer
    one here: for each of the (few dozen) partial pairs, all of the grid is
    done at once. Same sum, three orders of magnitude less interpreter.

    The result is inverted and ramped so that consonance is a peak, matching
    harmonic entropy, and then resampled from the (r, s) grid onto the
    triangle's own grid so both models are addressed identically.
    """
    eq = float(equave_ratio)
    width, height = _grid_shape(width)
    max_cents = 1200.0 * math.log2(eq)
    if not (max_cents > 0):
        return None

    fr = np.asarray(list(spectrum_freq), dtype=np.float64)
    am = np.asarray(list(spectrum_amp), dtype=np.float64)
    if fr.size == 0:
        return None

    # amp -> loudness, with silent partials contributing nothing rather than
    # -inf: Isoharmonics returns -inf for amp 0, which poisons the whole sum.
    safe = np.maximum(am, 1e-12)
    ld = np.where(am > 0, (2.0 ** ((20.0 * np.log10(safe)) / 10.0)) / 16.0, 0.0)

    step = max(0.002, float(step_size))
    rv = np.arange(1.0, eq + step, step)
    R, S = np.meshgrid(rv, rv, indexing="ij")

    total = np.zeros_like(R)
    for i in range(fr.size):
        f1 = float(ref_freq) * fr[i]
        l1 = ld[i]
        for j in range(fr.size):
            f2 = float(ref_freq) * fr[j]
            l2 = ld[j]
            total = total + (
                _dissonance(f1, f2, l1, l2)
                + _dissonance(R * f1, R * f2, l1, l2)
                + _dissonance(f1, R * f2, l1, l2)
                + _dissonance(S * f1, S * f2, l1, l2)
                + _dissonance(f1, S * f2, l1, l2)
                + _dissonance(R * f1, S * f2, l1, l2)
            )
    total = total / 2.0

    top = float(np.nanmax(total))
    z = total / top if top > 0 else total
    z = np.power(np.maximum(1.0 - z, 0.0), float(z_ramp))

    # The (r, s) grid is regular in ratio, so rather than triangulating it
    # (which is what scipy's griddata did, and what scipy was being loaded
    # for) each pixel is sent back through the triangle's map to its
    # fractional place in that grid and read bilinearly from the four
    # neighbours. Pixels that land outside the grid — below the r = s
    # diagonal, or past the equave — are NaN, as griddata left them.
    xi = np.linspace(0.0, max_cents, width)
    yi = np.linspace(0.0, max_cents * math.sqrt(3) / 2.0, height)
    XI, YI = np.meshgrid(xi, yi)
    c2 = YI * 2.0 / math.sqrt(3)
    c1 = XI - c2 / 2.0
    R = np.power(2.0, c1 / 1200.0)
    S = R * np.power(2.0, c2 / 1200.0)
    n = rv.size
    fi = (R - 1.0) / step
    fj = (S - 1.0) / step
    inside = (fi >= 0) & (fi <= n - 1) & (fj >= 0) & (fj <= n - 1)
    fi = np.clip(fi, 0, n - 1)
    fj = np.clip(fj, 0, n - 1)
    i0 = np.minimum(fi.astype(np.int64), n - 2)
    j0 = np.minimum(fj.astype(np.int64), n - 2)
    ti = fi - i0
    tj = fj - j0
    out = ((1.0 - ti) * (1.0 - tj) * z[i0, j0] + ti * (1.0 - tj) * z[i0 + 1, j0]
           + (1.0 - ti) * tj * z[i0, j0 + 1] + ti * tj * z[i0 + 1, j0 + 1])
    out = np.where(inside, out, np.nan)

    std = (float(spread_cents) / max_cents) * width
    if std >= 0.5:
        reach = int(round(std * 4))
        axis = np.arange(-reach, reach + 1)
        xv, yv = np.meshgrid(axis, axis)
        kernel = np.exp(-((xv ** 2 + yv ** 2) / (2.0 * std ** 2)))
        kernel /= kernel.sum()
        holes = np.isnan(out)
        filled = np.where(holes, 0.0, out)
        # Blur the field and the mask together and divide, so the edge of the
        # triangle is not dragged toward zero by the emptiness outside it.
        num = _fftconvolve_same(filled, kernel)
        den = _fftconvolve_same((~holes).astype(np.float64), kernel)
        out = np.where(den > 1e-9, num / np.maximum(den, 1e-9), np.nan)
        out[holes] = np.nan

    out[~_triangle_mask(width, height)] = np.nan
    return _pack(out)
`;
