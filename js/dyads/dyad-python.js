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
from triads_generator import _dissonance
from he_core import (
    fftconvolve_same as _fftconvolve_same, height_bound, weights, chord_metric,
    spreading_kernel, kernel_shape, splat, entropy, finite_range,
)


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


def _pack(z, up=1, **extra):
    """A curve, as the flat float32 buffer JS reads it back from.

    tolist() on a 1600-sample run is 1600 Python floats crossing the bridge one
    object at a time; the buffer is one copy. NaN survives the round trip and
    is what the renderers test for.

    "up" says which way concordance runs: +1 when a peak is a concordance
    (Sethares and Tenney are returned that way round), -1 when the value is an
    entropy and a concordance is a trough. The renderers read it rather than
    the model being flipped to suit them, so the number in the readout and the
    CSV is the model's own — nats, for entropy.
    """
    z = np.asarray(z, dtype=np.float32)
    lo, hi = finite_range(z)
    out = {"n": int(z.size), "min": lo, "max": hi, "up": int(up), "data": z.tobytes()}
    out.update(extra)
    return out


def _he_dyads(ax_hi, root, series="tenney"):
    """The n/d the entropy is a blur of, as one (N, 2) array with n/d >= 1.

    Tenney series: n*d <= root**2. Weil ("Farey") series: max(n, d) <= root.
    Every ratio up to ax_hi is taken — the caller pads the axis by the
    kernel's reach and asks for that much, and mirrors these below 1/1 itself.

    Vectorised the same way the triangle's is: the inner loop over d is one
    numpy block per n, because in Pyodide a few hundred thousand interpreted
    iterations is a visible pause on the page's own thread.
    """
    N = height_bound(root, 2, series)
    chunks = []
    top_d = int(root) if series == "weil" else int(math.isqrt(N))
    for d in range(1, top_d + 1):
        n_top = min(int(math.floor(d * ax_hi)), int(root) if series == "weil" else N // d)
        if n_top < d:
            continue
        n = np.arange(d, n_top + 1, dtype=np.int64)
        dd = np.full(n.size, d, dtype=np.int64)
        keep = np.gcd(n, dd) == 1
        if keep.any():
            chunks.append(np.stack([n[keep], dd[keep]], axis=1))
    if not chunks:
        return np.zeros((0, 2), dtype=np.int64)
    return np.concatenate(chunks)


def harmonic_entropy_curve(axis_ratio, width=1600, root=100, series="tenney",
                           alpha=4.0, spread_cents=17.0, beta=2.0):
    """Harmonic Renyi entropy over the interval axis, in nats.

        HE_a(c) = 1/(1-a) log sum_j P(j|c)^a,   P(j|c) = S(cents(j) - c)/||j|| / sum

    Every ratio under the height bound is stamped at its own cents with weight
    1/||j|| (1/sqrt(nd) for the Tenney series, 1/max(n,d) for Weil), the line
    is blurred by the spreading function of standard deviation spread_cents
    (Gaussian for beta 2, Laplace for beta 1), and the Renyi entropy of the
    blur is taken — by FFT, as HE-JS does it; see he_core. Low where one
    reading of the interval dominates, high where many are equally likely.

    The axis is padded by the kernel's reach on both sides and the ratios
    below 1/1 are stamped as well, so the value at 0 cents is the value of the
    unison and not of an edge. Spread is asked in CENTS rather than in
    samples, so raising the resolution sharpens the picture instead of
    changing the model.
    """
    ax = float(axis_ratio)
    width = max(64, int(width))
    max_cents = 1200.0 * math.log2(ax)
    if not (max_cents > 0):
        return None

    cell = max_cents / (width - 1)
    s = float(spread_cents)
    _, reach = kernel_shape(beta)
    pad_cents = reach * s
    pad = int(math.ceil(pad_cents / cell))

    f = _he_dyads(ax * 2.0 ** (pad_cents / 1200.0), root, series)
    if len(f) == 0:
        return None
    w = weights(f, series)
    c = 1200.0 * np.log2(f[:, 0] / f[:, 1])
    # The mirror image of every ratio within reach below 1/1 — d/n has the
    # same weight as n/d, and those are what the entropy at 0 cents is an
    # entropy OF. Without them the unison sits on a cliff.
    mirror = (c > 0) & (c <= pad_cents)
    c = np.concatenate([c, -c[mirror]])
    w = np.concatenate([w, w[mirror]])

    pos = (c + pad_cents) / cell
    grid = width + 2 * pad
    inside = (pos > -1) & (pos < grid)
    k, k2 = splat((grid,), pos[inside, None], w[inside], alpha)

    kernel = spreading_kernel(chord_metric(2), [cell], s, beta)
    h = entropy(k, k2, kernel, alpha)[pad:pad + width]
    return _pack(h, up=-1, unit="nats", count=int(len(f)))


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
