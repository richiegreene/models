/* =====================================================================
 *  HALFTONE — the picture in one ink
 * =====================================================================
 *
 * A colormap says a value with a colour. A halftone says it with COVERAGE:
 * how much of a small cell is inked, by a dot that grows, a line that
 * thickens, or two lines that cross. It is how a textbook printed a field
 * before it could print a colour, and it is still the cleanest way to put one
 * on a page — one ink, one ground, no ramp to explain in a caption.
 *
 * So this is a third kind of layout, beside the ramps and the constant, and
 * it is stricter than either: the ground is pure black or pure white with the
 * theme, the ink is the other, and everything drawn on it — the lattice, the
 * labels, the cursor, the contours — is drawn in the ink. Nothing in the
 * picture is a shade of grey except by being a screen of dots.
 *
 * THE SCREEN.  A square lattice of cells of pitch `size` pixels, turned 45°
 * — the angle every printed halftone is set at, because the eye finds a
 * straight row of dots long before it finds a diagonal one. Each cell reads
 * the value at its centre and inks itself by it:
 *
 *   dots    a circle whose AREA is the value, r = s·√(v/π), so the tone is
 *           linear in the value until the dots begin to touch
 *   lines   a hatch along the lattice whose WIDTH is the value, w = s·v
 *   cross   two hatches, each of width s·(1 − √(1 − v)), so that their
 *           union covers exactly v of the cell
 *
 * The same three are drawn two ways, and the arithmetic for both is here so
 * they cannot disagree: as GEOMETRY for the canvases and the SVG exporters —
 * circles and paths, which is what makes the export vector art rather than a
 * picture of some — and as a fragment-shader FUNCTION for the three WebGL
 * surfaces, where the screen is laid in screen space so the dots stay the
 * size the slider says however the shape is turned.
 * ------------------------------------------------------------------ */

import { themeIsLight } from './color-mapping.js';

/**
 * What the panel is set to. Shared by the three modes, like the colormap:
 * `method` is 'off' or one of the three screens, `size` the pitch in CSS
 * pixels.
 */
export const halftone = { method: 'off', size: 6 };

export const METHODS = ['dots', 'lines', 'cross'];

export function halftoneOn() { return halftone.method !== 'off'; }

/** The two colours there are: the ink, and the ground it is printed on. */
export function inkHex() { return themeIsLight() ? 0x000000 : 0xffffff; }
export function groundHex() { return themeIsLight() ? 0xffffff : 0x000000; }
export function inkCss() { return themeIsLight() ? '#000000' : '#ffffff'; }
export function groundCssHalftone() { return themeIsLight() ? '#ffffff' : '#000000'; }

/** The method as the shader takes it. */
export function methodIndex(method = halftone.method) {
    return method === 'dots' ? 1 : method === 'lines' ? 2 : method === 'cross' ? 3 : 0;
}

/**
 * For cache keys: what a screened picture is REBUILT for. The pitch is not
 * in it on purpose — it is a uniform on the surfaces and a cheap re-lay on
 * the canvases, and a slider that rebuilt a hundred thousand vertices on
 * every step would not be a slider.
 */
export function halftoneSignature() {
    return halftoneOn() ? `ht:${halftone.method}:${themeIsLight() ? 'l' : 'd'}` : 'ht:off';
}

const S2 = Math.SQRT1_2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ---------------------------------------------------------------------
 *  The screen as geometry
 * ------------------------------------------------------------------ */

/**
 * The marks of a screen over a rectangle, in the same pixel space `valueAt`
 * reads in.
 *
 * @param {number} x0, y0, x1, y1  the rectangle to cover
 * @param {(x:number, y:number) => number} valueAt  0..1 at a point, or NaN
 *        where there is nothing — outside the field, past the curve
 * @returns {{circles: number[], strokes: number[]}} circles as (x, y, r)
 *        triples; strokes as (x0, y0, x1, y1, width) quintuples, butt-capped,
 *        each one cell long so that neighbours along a hatch line join
 */
export function screenMarks(x0, y0, x1, y1, valueAt, method = halftone.method, size = halftone.size) {
    const circles = [];
    const strokes = [];
    const s = Math.max(1, size);
    /* Lattice coordinates (i, j) along the two diagonals; a cell centre is
       i·s along the first and j·s along the second. The rectangle's corners
       bound the range that has to be walked. */
    const toI = (x, y) => (x * S2 + y * S2) / s;
    const toJ = (x, y) => (-x * S2 + y * S2) / s;
    const cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    const iMin = Math.floor(Math.min(...cs.map(([x, y]) => toI(x, y)))) - 1;
    const iMax = Math.ceil(Math.max(...cs.map(([x, y]) => toI(x, y)))) + 1;
    const jMin = Math.floor(Math.min(...cs.map(([x, y]) => toJ(x, y)))) - 1;
    const jMax = Math.ceil(Math.max(...cs.map(([x, y]) => toJ(x, y)))) + 1;
    /* A hair over half a cell each way, so that two segments meeting along a
       hatch line overlap rather than show a seam. */
    const half = s * 0.505;

    for (let i = iMin; i <= iMax; i++) {
        for (let j = jMin; j <= jMax; j++) {
            const cx = (i - j) * S2 * s;
            const cy = (i + j) * S2 * s;
            if (cx < x0 - s || cx > x1 + s || cy < y0 - s || cy > y1 + s) continue;
            const raw = valueAt(cx, cy);
            if (!(raw === raw)) continue;
            const v = clamp01(raw);
            if (v <= 0.003) continue;

            if (method === 'dots') {
                circles.push(cx, cy, s * Math.sqrt(v / Math.PI));
            } else if (method === 'lines') {
                strokes.push(cx - half * S2, cy - half * S2, cx + half * S2, cy + half * S2, v * s);
            } else {
                const w = s * (1 - Math.sqrt(1 - v));
                strokes.push(cx - half * S2, cy - half * S2, cx + half * S2, cy + half * S2, w);
                strokes.push(cx + half * S2, cy - half * S2, cx - half * S2, cy + half * S2, w);
            }
        }
    }
    return { circles, strokes };
}

/** Put the marks on a canvas, in the ink. */
export function paintMarks(ctx, marks, ink = inkCss()) {
    ctx.save();
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineCap = 'butt';
    const c = marks.circles;
    if (c.length) {
        ctx.beginPath();
        for (let i = 0; i < c.length; i += 3) {
            ctx.moveTo(c[i] + c[i + 2], c[i + 1]);
            ctx.arc(c[i], c[i + 1], c[i + 2], 0, Math.PI * 2);
        }
        ctx.fill();
    }
    const st = marks.strokes;
    /* Grouped by width so the canvas is asked for a few dozen strokes rather
       than one per cell: the width is quantised to a sixteenth of a pixel,
       which no eye can see and no printer can hold. */
    if (st.length) {
        const byWidth = new Map();
        for (let i = 0; i < st.length; i += 5) {
            const w = Math.round(st[i + 4] * 16) / 16;
            if (w <= 0) continue;
            let p = byWidth.get(w);
            if (!p) { p = new Path2D(); byWidth.set(w, p); }
            p.moveTo(st[i], st[i + 1]);
            p.lineTo(st[i + 2], st[i + 3]);
        }
        for (const [w, p] of byWidth) {
            ctx.lineWidth = w;
            ctx.stroke(p);
        }
    }
    ctx.restore();
}

/**
 * The marks as SVG, in the ink.
 *
 * @param {(tag:string, attrs:object) => Element} el  the exporter's element maker
 * @param {(n:number) => string} f  its number formatter
 * @returns {Element} a group of circles and of one path per stroke width
 */
export function marksToSvg(el, f, marks, ink = inkCss()) {
    const g = el('g', { fill: ink, stroke: 'none' });
    const c = marks.circles;
    for (let i = 0; i < c.length; i += 3) {
        g.appendChild(el('circle', { cx: f(c[i]), cy: f(c[i + 1]), r: f(c[i + 2]) }));
    }
    const st = marks.strokes;
    if (st.length) {
        const byWidth = new Map();
        for (let i = 0; i < st.length; i += 5) {
            const w = Math.round(st[i + 4] * 16) / 16;
            if (w <= 0) continue;
            if (!byWidth.has(w)) byWidth.set(w, []);
            byWidth.get(w).push(`M${f(st[i])} ${f(st[i + 1])}L${f(st[i + 2])} ${f(st[i + 3])}`);
        }
        for (const [w, d] of byWidth) {
            g.appendChild(el('path', {
                d: d.join(''), fill: 'none', stroke: ink, 'stroke-width': f(w), 'stroke-linecap': 'butt',
            }));
        }
    }
    return g;
}

/* ---------------------------------------------------------------------
 *  The screen as a shader
 * ------------------------------------------------------------------ */

/**
 * GLSL for the same three screens, in screen space.
 *
 *   halftoneCoverage(p, v, cell, method) → 0..1
 *
 * `p` is gl_FragCoord.xy, `cell` the pitch in device pixels, `method` 1, 2
 * or 3 as methodIndex gives it. The lattice is the geometry's, turned 45°.
 * Edges are softened over about a pixel so the dots do not shimmer as the
 * shape turns. A dot near full value reaches into its neighbours' cells, so
 * the two nearest neighbours are tested as well as the cell's own.
 */
export const HALFTONE_GLSL = /* glsl */`
float htDot(vec2 f, float r, float aa) {
    return 1.0 - smoothstep(r - aa, r + aa, length(f));
}
float halftoneCoverage(vec2 p, float v, float cell, int method) {
    v = clamp(v, 0.0, 1.0);
    if (v <= 0.003) return 0.0;
    const float S2 = 0.70710678;
    vec2 q = vec2(p.x * S2 + p.y * S2, -p.x * S2 + p.y * S2) / cell;
    vec2 f = fract(q) - 0.5;
    float aa = 0.6 / cell;
    if (method == 1) {
        float r = sqrt(v / 3.14159265);
        float c = htDot(f, r, aa);
        c = max(c, htDot(f - vec2(sign(f.x), 0.0), r, aa));
        c = max(c, htDot(f - vec2(0.0, sign(f.y)), r, aa));
        return c;
    }
    if (method == 2) {
        float hw = 0.5 * v;
        return 1.0 - smoothstep(hw - aa, hw + aa, abs(f.y));
    }
    float hw = 0.5 * (1.0 - sqrt(max(0.0, 1.0 - v)));
    float a = 1.0 - smoothstep(hw - aa, hw + aa, abs(f.y));
    float b = 1.0 - smoothstep(hw - aa, hw + aa, abs(f.x));
    return max(a, b);
}
`;

/** The uniforms every screened material carries, filled from the panel. */
export function halftoneUniforms(pixelRatio = window.devicePixelRatio || 1) {
    const ink = inkHex(), ground = groundHex();
    const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
    return {
        uHtMethod: { value: methodIndex() },
        uHtCell: { value: Math.max(1, halftone.size) * pixelRatio },
        uHtInk: { value: rgb(ink) },
        uHtGround: { value: rgb(ground) },
    };
}

/** Bring a material's screen uniforms up to date with the panel. */
export function syncHalftoneUniforms(material, pixelRatio = window.devicePixelRatio || 1) {
    const u = material && material.uniforms;
    if (!u || !u.uHtMethod) return;
    const fresh = halftoneUniforms(pixelRatio);
    u.uHtMethod.value = fresh.uHtMethod.value;
    u.uHtCell.value = fresh.uHtCell.value;
    u.uHtInk.value = fresh.uHtInk.value;
    u.uHtGround.value = fresh.uHtGround.value;
}
