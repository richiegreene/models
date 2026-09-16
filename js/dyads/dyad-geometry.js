/* =====================================================================
 *  DYADS — the plot, as arithmetic
 * =====================================================================
 *
 * The canvas, the SVG exporter, the curve returned by Python and the interval
 * that sounds are four readings of one number, so the conversions between them
 * live here rather than three times over.
 *
 * THE NUMBER.  c is the interval in cents, from 0 at the unison to the width
 * of the axis — the equave taken `span` times over. A dyad is therefore a
 * point on a segment, and the picture is that segment laid along the bottom of
 * a box with the measure's value going up:
 *
 *     t = c / C          v = (z - min) / (max - min)
 *
 * with C the axis in cents. Sample 0 of the returned curve is the unison and
 * sample n-1 is the far end, so a curve index, a screen pixel and an interval
 * are the same point counted three ways — the same arrangement the triangle
 * uses, one dimension down.
 * ------------------------------------------------------------------ */

/** The equave, in cents. */
export function equaveCents(equaveRatio) {
    const e = Number(equaveRatio);
    return e > 1 ? 1200 * Math.log2(e) : 1200;
}

/** The whole axis, in cents: the equave taken `span` times. */
export function axisCents(equaveRatio, span) {
    return equaveCents(equaveRatio) * Math.max(1, Math.round(span));
}

/** The whole axis as a frequency ratio, which is what Python is asked for. */
export function axisRatio(equaveRatio, span) {
    const e = Number(equaveRatio) > 1 ? Number(equaveRatio) : 2;
    return Math.pow(e, Math.max(1, Math.round(span)));
}

/**
 * Where the plot box sits inside a pane.
 *
 * The left margin is wider than the others because the vertical axis is
 * labelled and the right one is not; the bottom is deeper than the top because
 * the cents ruler lives there. Both the canvas and the SVG exporter fit the
 * same box for the same rectangle, which is what lets the export be a picture
 * of what is on screen rather than an approximation of it.
 */
export function fitPlot(width, height, { padL = 58, padR = 22, padT = 26, padB = 46 } = {}) {
    const x0 = padL;
    const x1 = Math.max(padL + 1, width - padR);
    const y1 = padT;                                  // the top, y down
    const y0 = Math.max(padT + 1, height - padB);     // the baseline
    const w = x1 - x0;
    const h = y0 - y1;
    return {
        x0, x1, y0, y1, w, h,
        /** (t, v) in the unit box → pixels. v is up, the screen is down. */
        toPx: (t, v) => [x0 + t * w, y0 - v * h],
        /** Pixels → the unit box. */
        toUnit: (px, py) => [(px - x0) / w, (y0 - py) / h],
    };
}

/* ---------------------------------------------------------------------
 *  Reading a curve
 * ------------------------------------------------------------------ */

/**
 * A curve as it arrives from Python: a flat float32 run, NaN where the model
 * has nothing to say.
 */
export function wrapCurve(packed) {
    if (!packed) return null;
    const bytes = packed.data;
    const z = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    /* `up` is which way concordance runs: +1 when a peak is a concordance,
       −1 when the value is an entropy and a concordance is a trough. The
       curve keeps the model's own numbers — nats — and normalise() turns
       them for the picture. See wrapField in triad-geometry.js. */
    return {
        n: packed.n, min: packed.min, max: packed.max, z,
        up: packed.up === -1 ? -1 : 1,
        unit: packed.unit || '',
        count: packed.count || 0,
    };
}

/**
 * The model at a position along the axis, 0 to 1.
 *
 * Linear between samples. At 1600 samples over two octaves a sample is a cent
 * and a half, so this is smoothing over less than the ear's own resolution —
 * which is the point of computing the curve at a resolution nobody has to
 * think about.
 */
export function sampleCurve(curve, t) {
    if (!curve) return NaN;
    const f = Math.min(curve.n - 1, Math.max(0, t * (curve.n - 1)));
    const i = Math.floor(f);
    const j = Math.min(curve.n - 1, i + 1);
    const a = curve.z[i], b = curve.z[j];
    if (!(a === a)) return b;
    if (!(b === b)) return a;
    return a + (b - a) * (f - i);
}

/** The model at an interval in cents, which is how everything else asks. */
export function valueAtCents(curve, c, C) {
    return C > 0 ? sampleCurve(curve, c / C) : NaN;
}

/** 0..1 across the curve's own range, 1 the most concordant — for the
 *  colormap and the height, whichever way the model's numbers run. */
export function normalise(curve, v) {
    if (!curve || !(v === v)) return 0;
    const span = curve.max - curve.min;
    if (!(span > 1e-12)) return 0.5;
    const t = (v - curve.min) / span;
    return curve.up < 0 ? 1 - t : t;
}

/**
 * A sensible ruler for an axis this wide.
 *
 * Ticks every 100 cents while that is legible and every equave once it is not,
 * with a labelled one every third. The step is chosen from the axis rather
 * than fixed, because the same plot has to read at one octave and at three.
 */
export function centsTicks(C) {
    const step = C <= 1300 ? 100 : C <= 2600 ? 200 : 300;
    const out = [];
    for (let c = 0; c <= C + 1e-6; c += step) out.push(c);
    return { step, ticks: out };
}
