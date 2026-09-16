/* =====================================================================
 *  TETRADS — the tetrahedron, as arithmetic
 * =====================================================================
 *
 * The sprites, the entropy volume, the slice through it, the pointer and the
 * chord that sounds are five readings of one triple of numbers, so the
 * conversions between them live here rather than five times over — the
 * arrangement triad-geometry.js has for the triangle, one dimension up.
 *
 * THE TRIPLE.  c₁, c₂, c₃ are the three successive intervals of the tetrad,
 * in cents, none negative and summing to no more than the equave E. Divided
 * by E they are three of the four BARYCENTRIC coordinates of the regular
 * tetrahedron three-visualizer.js has always drawn:
 *
 *     u = c₁/E    v = c₂/E    w = c₃/E    a₀ = 1 − u − v − w
 *
 * with a₀ the weight on the apex. So the apex is 1:1:1:1, the three base
 * corners are the tetrads with the whole equave in one interval — 1:2:2:2,
 * 1:1:2:2 and 1:1:1:2 — and a₀ is one minus the SPAN, the outer interval of
 * the chord as a fraction of the equave. That is what makes a₀ = const a
 * musically legible cut: every tetrad on it has the same bass-to-soprano
 * interval, and the two inner voices are free.
 *
 * THE FRAME.  transformToRegularTetrahedron in three-visualizer.js is a
 * barycentric map, P = a₀·A + u·B₁ + v·B₂ + w·B₃ + offset; the matrix M whose
 * columns are B₁−A, B₂−A, B₃−A takes (u,v,w) to P − A − offset, and its
 * inverse takes a point on a slice — or a pointer hit — back to a chord. Both
 * are held here so the volume shader, the pick and the sprite placement can
 * not come to disagree about where a tetrad is.
 *
 * THE VOLUME.  Python returns the field as a cube of res³ float32 cells over
 * [0,E]³ indexed [c₁][c₂][c₃] — C order, so c₃ runs fastest — with the range
 * over the simplex and `up` = −1 (an entropy: a concordance is a trough).
 * sampleVolume reads it trilinearly, exactly as the GPU does from the same
 * bytes, so a CSV value and a pixel are the same number.
 * ------------------------------------------------------------------ */

import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';
import { transformToRegularTetrahedron } from '../components/three-visualizer.js';

/** The equave, in cents. Everything in the tetrahedron is a fraction of it. */
export function equaveCents(equaveRatio) {
    const e = Number(equaveRatio);
    return e > 1 ? 1200 * Math.log2(e) : 1200;
}

/**
 * The tetrahedron's own frame — its four corners in scene space, the matrix M
 * and its inverse — built once from the very map the sprites are placed by.
 *
 * Derived from transformToRegularTetrahedron rather than restated: the four
 * corners are simply that function asked for (0,0,0), (E,0,0), (0,E,0) and
 * (0,0,E), so if the tetrahedron is ever drawn differently this follows it.
 */
export const FRAME = (() => {
    const E = 1200;
    const corner = (c1, c2, c3) => new THREE.Vector3(...transformToRegularTetrahedron(c1, c2, c3, E));
    const apex = corner(0, 0, 0);
    const b1 = corner(E, 0, 0), b2 = corner(0, E, 0), b3 = corner(0, 0, E);
    const e1 = b1.clone().sub(apex), e2 = b2.clone().sub(apex), e3 = b3.clone().sub(apex);
    const M = new THREE.Matrix3().set(
        e1.x, e2.x, e3.x,
        e1.y, e2.y, e3.y,
        e1.z, e2.z, e3.z,
    );
    const Minv = M.clone().invert();
    return { apex, b1, b2, b3, M, Minv, corners: [apex, b1, b2, b3] };
})();

/** (u, v, w) → the scene. */
export function baryToLocal(u, v, w) {
    return new THREE.Vector3(u, v, w).applyMatrix3(FRAME.M).add(FRAME.apex);
}

/** The scene → (u, v, w). The inverse, which is the whole of picking. */
export function localToBary(p) {
    const d = p.clone().sub(FRAME.apex).applyMatrix3(FRAME.Minv);
    return { u: d.x, v: d.y, w: d.z };
}

export function centsToBary(c1, c2, c3, E) {
    return { u: c1 / E, v: c2 / E, w: c3 / E };
}

export function baryToCents(b, E) {
    return { c1: b.u * E, c2: b.v * E, c3: b.w * E };
}

/**
 * The nearest point inside the tetrahedron.
 *
 * Clamped in barycentric space rather than refused: a drag that runs off a
 * face slides along it instead of the sound stopping because a coordinate
 * went a thousandth negative — the arrangement clampCents has for the
 * triangle. The negative weights are zeroed and the rest renormalised.
 */
export function clampBary(b) {
    let a0 = Math.max(0, 1 - b.u - b.v - b.w);
    let u = Math.max(0, b.u), v = Math.max(0, b.v), w = Math.max(0, b.w);
    const sum = a0 + u + v + w;
    if (!(sum > 0)) return { u: 0, v: 0, w: 0 };
    return { u: u / sum, v: v / sum, w: w / sum };
}

export function insideBary(b, eps = 1e-9) {
    return b.u >= -eps && b.v >= -eps && b.w >= -eps && 1 - b.u - b.v - b.w >= -eps;
}

/* ---------------------------------------------------------------------
 *  Slices
 *
 *  Four families of cut, one per face, each holding one barycentric
 *  coordinate constant — which is the whole of what a tomograph does, and
 *  every cut is a triangle, so the picture on it is the triangle's own kind
 *  of picture. Which coordinate is held decides what the cut MEANS:
 *
 *    span    a₀ = const   every tetrad with the same outer interval; the two
 *                         inner voices roam. Parallel to the base, from the
 *                         apex (a unison) down to the base (an equave).
 *    lower   u  = const   the lower interval held; the upper three voices
 *                         are a triangle of triads over a fixed bass step.
 *    middle  v  = const   the middle interval held.
 *    upper   w  = const   the upper interval held; the lower three voices
 *                         are a triangle of triads under a fixed top step.
 *
 *  `t` is the held interval as a fraction of the equave, 0 to 1.
 * ------------------------------------------------------------------ */
export const AXES = ['span', 'lower', 'middle', 'upper'];

/**
 * The plane of a cut, as (n, d) in barycentric coordinates: n·(u,v,w) + d = 0.
 * For `span` the held interval is c₁+c₂+c₃, so the plane is u + v + w = t.
 */
export function slicePlane(axis, t) {
    const s = Math.min(1, Math.max(0, t));
    switch (axis) {
        case 'lower': return { n: [1, 0, 0], d: -s };
        case 'middle': return { n: [0, 1, 0], d: -s };
        case 'upper': return { n: [0, 0, 1], d: -s };
        default: return { n: [1, 1, 1], d: -s };
    }
}

/**
 * The three corners of a cut, in barycentric coordinates.
 *
 * A plane parallel to a face meets the other three edges from the opposite
 * corner, so the section is always a triangle: at t = 0 it is that corner
 * (a point, for `lower`/`middle`/`upper`) or the apex (for `span`), and it
 * grows to the far face at t = 1. Degenerate at the ends, deliberately — the
 * slider is allowed all the way to the corner.
 */
export function sliceTriangle(axis, t) {
    const s = Math.min(1, Math.max(0, t));
    const r = 1 - s;
    switch (axis) {
        case 'lower': return [{ u: s, v: 0, w: 0 }, { u: s, v: r, w: 0 }, { u: s, v: 0, w: r }];
        case 'middle': return [{ u: 0, v: s, w: 0 }, { u: r, v: s, w: 0 }, { u: 0, v: s, w: r }];
        case 'upper': return [{ u: 0, v: 0, w: s }, { u: r, v: 0, w: s }, { u: 0, v: r, w: s }];
        default: return [{ u: s, v: 0, w: 0 }, { u: 0, v: s, w: 0 }, { u: 0, v: 0, w: s }];
    }
}

/** What the held interval is, for the readout. */
export function axisLabel(axis) {
    return axis === 'lower' ? 'lower interval'
        : axis === 'middle' ? 'middle interval'
        : axis === 'upper' ? 'upper interval' : 'span';
}

/* ---------------------------------------------------------------------
 *  Reading the volume
 * ------------------------------------------------------------------ */

/**
 * The volume as it arrives from Python: res³ float32 cells, NaN where the
 * kernel never reached — beyond the faces, past the padding.
 */
export function wrapVolume(packed) {
    if (!packed) return null;
    const bytes = packed.data;
    const z = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    return {
        r: packed.r, min: packed.min, max: packed.max, z,
        up: packed.up === -1 ? -1 : 1,
        unit: packed.unit || '',
        count: packed.count || 0,
        cell: packed.cell || 0,
    };
}

/** Trilinear sample at (u, v, w), or NaN outside the data. */
export function sampleVolume(vol, u, v, w) {
    if (!vol) return NaN;
    const R = vol.r, n = R - 1;
    const fx = u * n, fy = v * n, fz = w * n;
    if (fx < 0 || fy < 0 || fz < 0 || fx > n || fy > n || fz > n) return NaN;
    const x0 = Math.min(n - 1, Math.floor(fx)), y0 = Math.min(n - 1, Math.floor(fy)), z0 = Math.min(n - 1, Math.floor(fz));
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const at = (x, y, z) => vol.z[(x * R + y) * R + z];
    /* A corner the kernel never reached would poison the interpolation, so
       the sample is taken over whichever corners are real. */
    let sum = 0, wt = 0;
    for (let i = 0; i < 8; i++) {
        const dx = i & 1, dy = (i >> 1) & 1, dz = (i >> 2) & 1;
        const val = at(x0 + dx, y0 + dy, z0 + dz);
        if (!(val === val)) continue;
        const k = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        sum += val * k; wt += k;
    }
    return wt > 0 ? sum / wt : NaN;
}

/** 0..1 across the volume's own range, 1 the most concordant. */
export function normaliseVolume(vol, v) {
    if (!vol || !(v === v)) return 0;
    const span = vol.max - vol.min;
    if (!(span > 1e-12)) return 0.5;
    const t = Math.min(1, Math.max(0, (v - vol.min) / span));
    return vol.up < 0 ? 1 - t : t;
}
