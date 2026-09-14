/* =====================================================================
 *  DYADS — the Python behind the curve
 * =====================================================================
 *
 * Four things are asked of Python in Dyads mode, and they are asked here so
 * that main.js writes one file and the rest of the app never touches a source
 * string again:
 *
 *   generate_dyads            which dyads exist at all, under the same limit,
 *                             equave and complexity settings the other two
 *                             modes are built from — theory/calculations.py is
 *                             imported rather than reimplemented, so a limit
 *                             means the same thing in all three.
 *   harmonic_entropy_curve    the triangle's entropy model, one dimension down.
 *   sethares_curve            sensory dissonance against the loaded timbre.
 *   tenney_curve              the Tenney norm made continuous.
 *
 * THE MEASURES, AND WHY THERE ARE FOUR KINDS.  A complexity measure on a
 * RATIO is cheap and there are six of them in the Complexity drawer already —
 * Tenney, Weil, Wilson, Euler, Benedetti, Arithmetic — and every one of them
 * is defined only AT the ratios. They say nothing about 351 cents, which is
 * not any ratio, so they can stand a lattice up and cannot draw a curve. That
 * is the mode's first setting. The other three are the families that are
 * defined EVERYWHERE:
 *
 *   PROBABILISTIC   harmonic entropy: how many simple readings the ear has to
 *                   choose between at this interval.
 *   PHYSICAL        Sethares: partial beating against partial, so it depends
 *                   on the timbre and not at all on the arithmetic.
 *   ARITHMETIC      the Tenney norm with a parabola let down from every ratio,
 *                   so the space between ratios has a value too. This is the
 *                   continuous extension the published comparison found fits
 *                   listeners better than any of the discrete measures.
 *
 * Nothing here draws. Each model returns the raw curve over a fixed grid and
 * everything else — the colouring, the drawing, the export — is done in JS,
 * for the same reason the triangle's models do: a picture cannot be
 * recoloured, refitted or emitted as vectors without being computed again.
 * ------------------------------------------------------------------ */

export const DYADS_PY = `import math
import numpy as np
from fractions import Fraction
from theory.calculations import (
    get_odd_limit, get_integer_limit, check_prime_limit, parse_primes,
    _generate_valid_numbers, calculate_complexity, cents, gcd,
    get_virtual_fundamental_denominator,
)
# The same Plomp-Levelt kernel the triangle's surface is built from, imported
# rather than copied: there is one statement of roughness in this app and both
# modes are pictures of it.
from triads_generator import _dissonance, _fftconvolve_same


def generate_dyads(limit_value, axis_ratio, limit_mode="odd", max_exponent=3,
                   complexity_measure="Tenney", hide_unison_voices=False,
                   omit_octaves=False, virtual_fundamental_filter=None):
    """Every JI dyad inside the axis, as (cents, "i:j", complexity).

    The triangle's generator with another voice taken away: the same valid
    numbers, the same filters, the same per-interval limit test, the same
    complexity. One pass returning position and label together, so there is no
    join between coordinates and names that could miss.

    Note that the axis, not the equave, is the bound. A dyad is the one chord
    that stays perfectly readable beyond one equave — see dyad-state.js — so
    the caller passes the whole width of the plot and gets the intervals that
    are actually in the picture.
    """
    out = []
    ax = float(axis_ratio)

    valid_numbers = _generate_valid_numbers(limit_value, limit_mode, max_exponent, ax)
    if not valid_numbers:
        return []
    nums = sorted(list(valid_numbers))
    primes = parse_primes(limit_value) if limit_mode == "prime" else []

    for a_i in range(len(nums)):
        i = nums[a_i]
        if i == 0:
            continue
        for b_i in range(a_i, len(nums)):
            j = nums[b_i]
            if hide_unison_voices and i == j:
                continue
            if j / i > ax:
                continue
            if gcd(i, j) != 1:
                continue

            if omit_octaves:
                r = j / i
                if r > 1 and math.isclose(math.log2(r), round(math.log2(r))):
                    continue

            if virtual_fundamental_filter:
                vf = get_virtual_fundamental_denominator((i, j))
                if vf is None or vf not in virtual_fundamental_filter:
                    continue

            interval = Fraction(j, i)
            if limit_mode == "odd":
                if get_odd_limit(interval) > int(limit_value):
                    continue
            elif limit_mode == "integer":
                if get_integer_limit(interval) > int(limit_value):
                    continue
            elif limit_mode == "prime":
                if not check_prime_limit(interval, primes, int(max_exponent)):
                    continue

            complexity = calculate_complexity(complexity_measure, interval)
            out.append((cents(j / i), "%d:%d" % (i, j), complexity))

    return out


def _pack(z):
    """A curve, as the flat float32 buffer JS reads it back from.

    tolist() on a 1600-sample run is 1600 Python floats crossing the bridge one
    object at a time; the buffer is one copy. NaN survives the round trip and
    is what the renderers test for.
    """
    z = np.asarray(z, dtype=np.float32)
    finite = z[np.isfinite(z)]
    lo = float(finite.min()) if finite.size else 0.0
    hi = float(finite.max()) if finite.size else 1.0
    return {"n": int(z.size), "min": lo, "max": hi, "data": z.tobytes()}


def _he_dyads(ax, n_limit, c_limit):
    """The i:j the entropy is a blur of, as one (N, 2) array.

    Vectorised the same way the triangle's is: the inner loop over j is one
    numpy block per i, because in Pyodide a few hundred thousand interpreted
    iterations is a visible pause on the page's own thread.
    """
    chunks = []
    for i in range(1, int(n_limit) + 1):
        j_top = min(int(math.floor(i * ax)), c_limit // i)
        if j_top < i:
            continue
        j = np.arange(i, j_top + 1, dtype=np.int64)
        ii = np.full(j.size, i, dtype=np.int64)
        keep = np.gcd(ii, j) == 1
        if keep.any():
            chunks.append(np.stack([ii[keep], j[keep]], axis=1))
    if not chunks:
        return np.zeros((0, 2), dtype=np.int64)
    return np.concatenate(chunks)


def harmonic_entropy_curve(axis_ratio, width=1600, n_limit=160, c_limit=1000000,
                           alpha=7.0, spread_cents=17.0):
    """Renyi harmonic entropy over the interval axis.

    Every ratio inside the axis is stamped at its own cents with weight
    1/sqrt(ij), the line is blurred by the ear's uncertainty, and the Renyi
    entropy of the blur is taken. High where there are many simple readings of
    the same interval to choose between, low where one reading dominates.
    Returned as 7 - H so that a concordance is a peak, which is the shape the
    plot is drawn as and the sign the other three models are stated in.

    Spread is asked in CENTS rather than in samples, so raising the resolution
    sharpens the picture instead of changing the model.
    """
    ax = float(axis_ratio)
    width = max(64, int(width))
    max_cents = 1200.0 * math.log2(ax)
    if not (max_cents > 0):
        return None

    f = _he_dyads(ax, n_limit, int(c_limit))
    if len(f) == 0:
        return None

    ff = f.astype(np.float64)
    w = 1.0 / np.sqrt(ff[:, 0] * ff[:, 1])
    c = 1200.0 * np.log2(ff[:, 1] / ff[:, 0])

    px = np.round((c / max_cents) * (width - 1)).astype(np.int64)
    inside = (px >= 0) & (px < width)
    px, w = px[inside], w[inside]
    if px.size == 0:
        return None

    k = np.zeros(width, dtype=np.float64)
    k_a = np.zeros(width, dtype=np.float64)
    np.add.at(k, px, w)
    np.add.at(k_a, px, w ** alpha)

    std = max(1.0, (float(spread_cents) / max_cents) * width)
    reach = int(round(std * 4))
    axis = np.arange(-reach, reach + 1)
    s = np.exp(-(axis ** 2) / (2.0 * std ** 2))

    p_k = _fftconvolve_same(k, s)
    p_ka = _fftconvolve_same(k_a, s ** alpha)

    eps = 1e-16
    # fftconvolve can land a hair below zero where the true value is zero, and
    # a negative base under a fractional power is a NaN hole in the curve.
    p_k = np.maximum(p_k, 0.0)
    p_ka = np.maximum(p_ka, 0.0)
    entropy = (1.0 / (1.0 - alpha)) * np.log((eps + p_ka) / (eps + p_k ** alpha))

    return _pack(7.0 - entropy)


def sethares_curve(spectrum_freq, spectrum_amp, ref_freq, axis_ratio,
                   width=1600, z_ramp=1.0):
    """Sensory dissonance of the dyad 1 : r, over the interval axis.

    Every partial of the lower tone against every partial of the upper, summed
    by the Plomp-Levelt curve as Sethares parameterises it. The whole axis is
    done at once for each pair of partials, rather than the pairs being walked
    for each point of the axis: same sum, three orders of magnitude less
    interpreter.

    Only the CROSS terms are counted. A tone's partials also beat against each
    other, but that is a constant — it is the same whatever the interval is —
    and including it would only compress the curve toward a flat line without
    moving a single peak. What is drawn here is the dissonance BETWEEN the two
    notes, which is what the mode is asking about.

    Inverted and ramped so that consonance is a peak, matching the other three.
    """
    ax = float(axis_ratio)
    width = max(64, int(width))
    max_cents = 1200.0 * math.log2(ax)
    if not (max_cents > 0):
        return None

    fr = np.asarray(list(spectrum_freq), dtype=np.float64)
    am = np.asarray(list(spectrum_amp), dtype=np.float64)
    if fr.size == 0:
        return None

    # amp -> loudness, with silent partials contributing nothing rather than
    # -inf: a zero amplitude through a log poisons the whole sum.
    safe = np.maximum(am, 1e-12)
    ld = np.where(am > 0, (2.0 ** ((20.0 * np.log10(safe)) / 10.0)) / 16.0, 0.0)

    c = np.linspace(0.0, max_cents, width)
    r = np.power(2.0, c / 1200.0)

    total = np.zeros(width, dtype=np.float64)
    for i in range(fr.size):
        f1 = float(ref_freq) * fr[i]
        l1 = ld[i]
        for j in range(fr.size):
            f2 = float(ref_freq) * fr[j]
            total = total + _dissonance(f1, r * f2, l1, ld[j])

    top = float(np.nanmax(total))
    z = total / top if top > 0 else total
    return _pack(np.power(np.maximum(1.0 - z, 0.0), float(z_ramp)))


def tenney_curve(axis_ratio, width=1600, depth=50, softness=20.0):
    """The Tenney norm, made continuous.

    log2(pq) is defined only at the ratios, so it can mark a lattice and cannot
    draw a curve. The extension is to let a parabola down from every ratio and
    take the lowest surface any of them reaches:

        T(x) = min over p/q of   ((x - cents(p/q)) / s)^2 + log2(pq)

    A simple ratio therefore digs a deep well and a complex one a shallow
    dimple, and a point between two ratios takes whichever it is closer to
    being. The softness s is how wide those wells are — the one number that
    decides whether the curve is a row of spikes or a smooth landscape.

    Negated on the way out, so that a simple interval is a PEAK like the other
    three models rather than a trough — which is the sign every measure on
    this plot is stated in, so that "concordant is high" is true of all of
    them and Relief can scale them all about one middle.
    """
    ax = float(axis_ratio)
    width = max(64, int(width))
    max_cents = 1200.0 * math.log2(ax)
    if not (max_cents > 0):
        return None

    depth = max(2, int(depth))
    s = max(1.0, float(softness))
    xs = np.linspace(0.0, max_cents, width)
    best = np.full(width, np.inf)

    for q in range(1, depth + 1):
        p = np.arange(q, int(math.floor(q * ax)) + 1, dtype=np.int64)
        if p.size == 0:
            continue
        p = p[np.gcd(p, np.full(p.size, q, dtype=np.int64)) == 1]
        if p.size == 0:
            continue
        c = 1200.0 * np.log2(p / float(q))
        norm = np.log2(p.astype(np.float64) * q)
        # One row per ratio, minimised down the stack: the whole axis against
        # the whole set of parabolas in one operation.
        d = (xs[None, :] - c[:, None]) / s
        best = np.minimum(best, np.min(d * d + norm[:, None], axis=0))

    return _pack(-best)
`;
