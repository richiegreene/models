/* =====================================================================
 *  TRIADS — the triangle, as arithmetic
 * =====================================================================
 *
 * The 2D pane, the 3D pane, the field returned by Python and the chord that
 * sounds are four readings of one pair of numbers, so the conversions between
 * them live here rather than three times over.
 *
 * THE PAIR.  c1 is the lower interval of the triad and c2 the upper, both in
 * cents above the note below them, with c1 + c2 no wider than the equave E.
 * A triad is therefore a point in a right triangle of side E, and it is drawn
 * as an equilateral one under the standard shear:
 *
 *     gx = (c1 + c2/2) / E        gy = c2 / E
 *
 * with the shape running (0,0) bottom-left, (1,0) bottom-right and
 * (0.5, √3/2) at the apex. Bottom-left is the unison, bottom-right puts the
 * whole equave in the lower interval, the apex puts it in the upper one, and
 * the bottom edge is every triad whose top two voices are the same note.
 * This is the frame Python stamps its grids in — see triad-python.js — so a
 * grid index, a screen pixel and a chord are the same point counted three
 * ways.
 * ------------------------------------------------------------------ */

export const SQRT3_2 = Math.sqrt(3) / 2;

/** The equave, in cents. Everything on the triangle is a fraction of this. */
export function equaveCents(equaveRatio) {
    const e = Number(equaveRatio);
    return e > 1 ? 1200 * Math.log2(e) : 1200;
}

/** (c1, c2) → the unit shape, where the triangle is (0,0)–(1,0)–(0.5,√3/2). */
export function centsToShape(c1, c2, E) {
    return { gx: (c1 + c2 / 2) / E, gy: c2 / E };
}

/** Back again. gy is the fraction of the equave in the UPPER interval. */
export function shapeToCents(gx, gy, E) {
    const c2 = gy * E;
    return { c1: gx * E - c2 / 2, c2 };
}

/**
 * The three barycentric weights — left (unison), right (all of E below), apex.
 *
 * Used for the containment test rather than a point-in-polygon walk, because
 * the same three numbers are what a clamp has to act on: a pointer that has
 * strayed outside is put back by zeroing the negative weight and renormalising,
 * which slides it to the nearest edge instead of stopping the drag dead.
 */
export function barycentric(gx, gy) {
    const apex = gy;
    const right = gx - gy / 2;
    return { left: 1 - apex - right, right, apex };
}

export function insideTriangle(gx, gy, eps = 1e-9) {
    const b = barycentric(gx, gy);
    return b.left >= -eps && b.right >= -eps && b.apex >= -eps;
}

/**
 * The nearest point inside the triangle, as cents.
 *
 * Clamping in barycentric space rather than refusing out-of-range keeps a
 * drag continuous: run the pointer off the edge and the chord follows along
 * that edge, which is what a hand expects, rather than the sound stopping
 * because a coordinate went a thousandth negative.
 */
export function clampCents(c1, c2, E) {
    const { gx, gy } = centsToShape(c1, c2, E);
    let { left, right, apex } = barycentric(gx, gy);
    left = Math.max(0, left); right = Math.max(0, right); apex = Math.max(0, apex);
    const sum = left + right + apex;
    if (!(sum > 0)) return { c1: 0, c2: 0 };
    right /= sum; apex /= sum;
    return { c1: right * E, c2: apex * E };
}

/* ---------------------------------------------------------------------
 *  Where the triangle sits in a box
 *
 *  Both the canvas and the SVG exporter need the same three vertices for a
 *  given rectangle, and an equilateral triangle in a box of any proportion is
 *  fitted by whichever of width and height runs out first.
 * ------------------------------------------------------------------ */
export function fitTriangle(width, height, pad = 22) {
    const w = Math.max(1, width - pad * 2);
    const h = Math.max(1, height - pad * 2);
    const side = Math.min(w, h / SQRT3_2);
    const originX = (width - side) / 2;
    const originY = (height + side * SQRT3_2) / 2; // the baseline, y down
    return {
        side,
        originX,
        originY,
        /** Shape coordinates → pixels. y is flipped: shape up, screen down. */
        toPx: (gx, gy) => [originX + gx * side, originY - gy * SQRT3_2 * side],
        /** Pixels → shape coordinates. */
        toShape: (px, py) => [(px - originX) / side, (originY - py) / (SQRT3_2 * side)],
        /** The corners, in the order the field's mask uses them. */
        vertices: () => [
            [originX, originY],                              // unison
            [originX + side, originY],                       // equave below
            [originX + side / 2, originY - side * SQRT3_2],  // equave above
        ],
    };
}

/* ---------------------------------------------------------------------
 *  Reading a field
 * ------------------------------------------------------------------ */

/**
 * A field as it arrives from Python: a flat float32 grid, NaN outside.
 *
 * Row 0 is the baseline, so a row index counts upward the way gy does and the
 * flip belongs to whoever is drawing rather than to the data.
 *
 * `up` is which way concordance runs — +1 when a peak is a concordance
 * (Sethares), −1 when the value is an entropy and a concordance is a trough.
 * The model is not flipped to suit the picture: the number stays the model's
 * own (nats, for entropy) and normalise() below does the turning, so the
 * readout and the CSV say what the model said.
 */
export function wrapField(packed) {
    if (!packed) return null;
    const bytes = packed.data;
    const z = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    return {
        w: packed.w, h: packed.h, min: packed.min, max: packed.max, z,
        up: packed.up === -1 ? -1 : 1,
        unit: packed.unit || '',
        count: packed.count || 0,
    };
}

/** Bilinear sample at shape coordinates, or NaN outside. */
export function sampleField(field, gx, gy) {
    if (!field) return NaN;
    const fx = gx * (field.w - 1);
    const fy = gy * (field.h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 >= field.w - 1 || y0 >= field.h - 1) {
        const xi = Math.round(fx), yi = Math.round(fy);
        if (xi < 0 || yi < 0 || xi >= field.w || yi >= field.h) return NaN;
        return field.z[yi * field.w + xi];
    }
    const tx = fx - x0, ty = fy - y0;
    const a = field.z[y0 * field.w + x0], b = field.z[y0 * field.w + x0 + 1];
    const c = field.z[(y0 + 1) * field.w + x0], d = field.z[(y0 + 1) * field.w + x0 + 1];
    /* A corner falling outside the triangle would poison the interpolation, so
       an edge sample is taken from whichever corners are real. */
    if (!(a === a) || !(b === b) || !(c === c) || !(d === d)) {
        const xs = [a, b, c, d].filter((v) => v === v);
        return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN;
    }
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** 0..1 across the field's own range, 1 the most concordant — for the
 *  colormap and the relief, whichever way the model's own numbers run. */
export function normalise(field, v) {
    if (!field || !(v === v)) return 0;
    const span = field.max - field.min;
    if (!(span > 1e-12)) return 0.5;
    const t = (v - field.min) / span;
    return field.up < 0 ? 1 - t : t;
}
