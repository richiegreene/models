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
 *
 * WHY THAT SHEAR IS NOT ONLY A PICTURE.  It is the metric of pitch space: a
 * triad heard up to transposition is a point in the plane orthogonal to
 * (1,1,1), and in that plane the equilateral triangle is the honest shape.
 * So the ear's uncertainty — every voice mistuned independently — is an
 * ISOTROPIC Gaussian on this grid, with σ = s·√3/2 for the wiki's interval
 * spread s; Sintel's std of 15 is s ≈ 17.3 ¢, the canonical one percent.
 * See chord_metric in he-python.js, which is where the tetrahedron gets the
 * same answer in one dimension more.
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
from he_core import (
    fftconvolve_same, height_bound, weights, kernel_shape, spreading_kernel,
    splat, entropy, finite_range, chord_key, chord_unkey,
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


# The FFT convolution lives in he_core now — one statement for the three modes —
# and keeps its old name here because sethares_grid and the dyads' Plomp-Levelt
# smoothing were written against it.
_fftconvolve_same = fftconvolve_same


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


def _pack(z, up=1, **extra):
    """A field, as the flat float32 buffer JS reads it back from.

    tolist() on a 420x364 grid is 150,000 Python floats crossing the bridge one
    object at a time; the buffer is one copy. NaN marks outside the triangle
    and survives the round trip, which is what the renderers test for.

    "up" is which way concordance runs: +1 when a peak is a concordance, -1
    when the value is an entropy and a concordance is a trough. The renderers
    read it, so an entropy stays in nats all the way to the CSV.
    """
    z = np.asarray(z, dtype=np.float32)
    lo, hi = finite_range(z)
    out = {
        "w": int(z.shape[1]),
        "h": int(z.shape[0]),
        "min": lo,
        "max": hi,
        "up": int(up),
        "data": z.tobytes(),
    }
    out.update(extra)
    return out


def _he_triads(eq_hi, root, series="tenney"):
    """The a:b:c the entropy is a blur of, as one (N, 3) array, a <= b <= c.

    Tenney series: a*b*c <= root**3 — Sintel's own set is root 300, the
    27 000 000 of his notebook. Weil series: c <= root. The span is taken up
    to eq_hi rather than the equave, because the caller pads the triangle by
    the kernel's reach and needs the chords just past its top edge.

    Isoharmonics builds this with three nested Python loops — about nine
    million iterations at root 300, each doing a gcd. Here the inner two are
    one vectorised block per a: b runs over its range, each b gets its own
    count of c, and np.repeat lays them out flat.
    """
    weil = series == "weil"
    N = height_bound(root, 3, series)
    chunks = []
    for a in range(1, int(root) + 1):
        top = int(math.floor(a * eq_hi))
        b_top = min(top, int(root)) if weil else min(top, N // a)
        if b_top < a:
            continue
        b = np.arange(a, b_top + 1, dtype=np.int64)
        c_top = np.minimum(top, int(root)) if weil else np.minimum(top, N // (a * b))
        # np.intp, not int64: Pyodide's numpy is a 32-bit build, and repeat()
        # refuses an int64 count array there as an unsafe cast. Everything else
        # stays int64 — a*b*c reaches 27 million and must not wrap.
        counts = np.maximum(0, c_top - b + 1).astype(np.intp)
        total = int(counts.sum())
        if total == 0:
            continue
        bb = np.repeat(b, counts)
        starts = np.concatenate(([0], np.cumsum(counts)[:-1])).astype(np.int64)
        cc = bb + (np.arange(total, dtype=np.int64) - np.repeat(starts, counts))
        aa = np.full(total, a, dtype=np.int64)
        keep = np.gcd(np.gcd(aa, bb), cc) == 1
        if keep.any():
            chunks.append(np.stack([aa[keep], bb[keep], cc[keep]], axis=1))
    if not chunks:
        return np.zeros((0, 3), dtype=np.int64)
    return np.concatenate(chunks)


_PERMS3 = [(0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)]


def _shape_xy(c1, c2):
    """Cents → Sintel's equilateral coordinates, in cents."""
    return c1 + c2 / 2.0, c2 * math.sqrt(3) / 2.0


def harmonic_entropy_grid(equave_ratio, width=420, root=300, series="tenney",
                          alpha=4.0, spread_cents=17.0, beta=2.0):
    """Harmonic Renyi entropy over the triangle, in nats — Sintel's model.

    Every triad under the height bound is stamped at its point with weight
    1/||j|| (1/sqrt(abc) for the Tenney series, 1/max for Weil), the field is
    blurred by the spreading function, and the Renyi entropy of the blur is
    taken by FFT; see he_core. Low where one reading of the sonority
    dominates, high where the ear has many to choose between.

    The blur is isotropic on this grid with σ = s·√3/2, which is what "every
    voice mistuned independently" comes to in these coordinates — see the
    note at the top of this file. The triangle is padded by the kernel's
    reach and the chords just outside each edge are stamped too — a:c:b lies
    across the bottom edge from a:b:c, b:a:c across the left one — so an edge
    is not a cliff in the basis set.

    Spread is asked in CENTS rather than in pixels, so a resolution change
    sharpens the picture instead of changing the model.
    """
    eq = float(equave_ratio)
    width, height = _grid_shape(width)
    max_cents = 1200.0 * math.log2(eq)
    if not (max_cents > 0):
        return None

    cell_x = max_cents / (width - 1)
    cell_y = (max_cents * math.sqrt(3) / 2.0) / (height - 1)
    s = float(spread_cents)
    _, reach = kernel_shape(beta)
    sigma_grid = s * math.sqrt(3) / 2.0
    pad_cents = reach * sigma_grid
    pad_x = int(math.ceil(pad_cents / cell_x))
    pad_y = int(math.ceil(pad_cents / cell_y))

    f = _he_triads(eq * 2.0 ** (pad_cents / 1200.0), root, series)
    if len(f) == 0:
        return None
    w = weights(f, series)

    def intervals(g):
        gg = g.astype(np.float64)
        return 1200.0 * np.log2(gg[:, 1] / gg[:, 0]), 1200.0 * np.log2(gg[:, 2] / gg[:, 1])

    c1, c2 = intervals(f)
    # Reflected copies for the chords within reach of an edge: the other
    # orderings of a:b:c, kept where they land inside the padded triangle and
    # made unique, since a chord with a repeated voice has fewer than six.
    tol = pad_cents / max_cents
    near = (c1 <= pad_cents) | (c2 <= pad_cents)
    if near.any():
        fn = f[near]
        keys = []
        for perm in _PERMS3:
            g = fn[:, list(perm)]
            p1, p2 = intervals(g)
            bl = 1.0 - (p1 + p2) / max_cents
            ok = (p1 / max_cents >= -tol) & (p2 / max_cents >= -tol) & (bl >= -tol)
            if ok.any():
                keys.append(chord_key(g[ok]))
        if keys:
            images = chord_unkey(np.unique(np.concatenate(keys)), 3)
            # A reordering of a sorted chord is never itself sorted unless two
            # voices are equal — and then it IS the chord, already stamped.
            images = images[~((images[:, 0] <= images[:, 1]) & (images[:, 1] <= images[:, 2]))]
            if len(images):
                i1, i2 = intervals(images)
                c1 = np.concatenate([c1, i1]); c2 = np.concatenate([c2, i2])
                w = np.concatenate([w, weights(np.sort(images, axis=1), series)])

    x, y = _shape_xy(c1, c2)
    px = x / cell_x + pad_x
    py = y / cell_y + pad_y
    gw, gh = width + 2 * pad_x, height + 2 * pad_y
    inside = (px > -1) & (px < gw) & (py > -1) & (py < gh)
    k, k2 = splat((gh, gw), np.stack([py[inside], px[inside]], axis=1), w[inside], alpha)

    # Isotropic here: (4/3) I is chord_metric(3) written in these coordinates,
    # so the kernel comes out with σ = s·√3/2 on both axes.
    kernel = spreading_kernel((4.0 / 3.0) * np.eye(2), [cell_y, cell_x], s, beta)
    h = entropy(k, k2, kernel, alpha)[pad_y:pad_y + height, pad_x:pad_x + width]

    h[~_triangle_mask(width, height)] = np.nan
    return _pack(h, up=-1, unit="nats", count=int(len(f)))


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
