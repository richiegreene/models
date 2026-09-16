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
 * surfaces.
 *
 * WHERE THE SCREEN IS LAID.  On the lifted surfaces there are two answers,
 * and `shape` chooses between them:
 *
 *   screen  the lattice is laid on the glass — gl_FragCoord — so the dots
 *           stay the size the slider says however the surface is turned,
 *           exactly as they are on the flat pane. The surface shows through
 *           a fixed screen, the way a photograph does through the printer's.
 *   shape   the lattice is laid on the SURFACE, in its own coordinates, and
 *           turns, tilts and foreshortens with it: the dots are ON the relief
 *           rather than in front of it. On the tetrahedron's body the screen
 *           is a three-dimensional lattice, and its marks are globes and
 *           rods hanging in the volume, sized by the concordance at each
 *           lattice point — so a well of concordance appears as a cluster,
 *           packed solid at its centre and thinning to a sprinkle of small
 *           stars at its edge.
 *
 * The pitch means the same in both: `size` pixels, measured for the shape
 * lay at the framing the pane opens on, so that switching the lay leaves the
 * screen the same fineness at the view the app chose and lets it grow and
 * shrink from there with the zoom.
 * ------------------------------------------------------------------ */

import { themeIsLight } from './color-mapping.js';

/**
 * What the panel is set to. Shared by the three modes, like the colormap:
 * `method` is 'off' or one of the three screens, `size` the pitch in CSS
 * pixels, `shape` whether the screen is laid on the surface rather than on
 * the glass — see the head of the file. The flat panes have no surface to
 * lay it on and ignore it.
 */
export const halftone = { method: 'off', size: 6, shape: false };

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
 * every step would not be a slider. Nor is the lay: one shader draws both,
 * and which it draws is a uniform.
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
 * GLSL for the same three screens, on a surface.
 *
 *   halftoneCoverage(p, v, cell, method) → 0..1     laid on the glass
 *   halftoneSurface(s, v, cell, method)  → 0..1     laid on the surface
 *
 * Both are the one screen, `htScreen`, over a lattice in CELL units — a
 * cell is one unit, the lattice is the geometry's, turned 45° — and differ
 * only in what they lay it over. For the glass `p` is gl_FragCoord.xy and
 * `cell` the pitch in device pixels; for the surface `s` is any 2D
 * coordinate on it (the plan of a relief, the plane of a section) and `cell`
 * the pitch in the same units. `method` is 1, 2 or 3 as methodIndex gives
 * it.
 *
 * Edges are softened over about a pixel so the dots do not shimmer as the
 * shape turns. On the glass a pixel is a known fraction of a cell; on the
 * surface it is whatever the projection makes it, which is what fwidth
 * measures — and it is measured before any branch on the value, because a
 * derivative taken inside one is undefined. A dot near full value reaches
 * into its neighbours' cells, so the two nearest neighbours are tested as
 * well as the cell's own.
 */
export const HALFTONE_GLSL = /* glsl */`
float htDot(vec2 f, float r, float aa) {
    return 1.0 - smoothstep(r - aa, r + aa, length(f));
}
vec2 htLattice(vec2 p, float cell) {
    const float S2 = 0.70710678;
    return vec2(p.x * S2 + p.y * S2, -p.x * S2 + p.y * S2) / cell;
}
float htScreen(vec2 q, float v, int method, float aa) {
    v = clamp(v, 0.0, 1.0);
    if (v <= 0.003) return 0.0;
    vec2 f = fract(q) - 0.5;
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
float halftoneCoverage(vec2 p, float v, float cell, int method) {
    return htScreen(htLattice(p, cell), v, method, 0.6 / cell);
}
float halftoneSurface(vec2 s, float v, float cell, int method) {
    vec2 q = htLattice(s, cell);
    float aa = 0.42 * max(max(fwidth(q.x), fwidth(q.y)), 1e-5);
    return htScreen(q, v, method, aa);
}
`;

/**
 * GLSL for the screen in three dimensions — the body of the tetrahedron.
 *
 *   halftoneVolume(o, d, t0, t1, cell, method, px) → 0..1
 *
 * A cubic lattice of pitch `cell` in the shape's own space, stood on a
 * corner so that its body diagonal runs up the apex: no face of the cube is
 * then square to a face of the tetrahedron, and no view along the shape's
 * own axes looks straight down a row. Each lattice cell holds one mark,
 * sized by the value at its centre — `htValueAt`, which the including
 * shader supplies — and staying inside its cell:
 *
 *   dots    a globe whose projected AREA is the value, r = ½·√v cells
 *   lines   a rod along one lattice axis whose WIDTH is the value, r = ½·v
 *   cross   three rods, one along each axis, weighted as the flat cross is
 *
 * A CLUSTER, NOT A CRYSTAL.  A globe is moved off its lattice point by a
 * hash of the point, by as much as its cell has room for: the big globes of
 * a well's core are packed and hardly move, the small ones of its halo
 * scatter. Seen in depth a regular lattice is a crystal — rows and moiré
 * that swing about as the shape turns — and a well should read as a swarm
 * that thickens toward its centre, which is what the scatter makes of it.
 * Rods keep their lattice: a rod is one cell long and joins its neighbours,
 * and a hatch that did not line up would not be a hatch.
 *
 * The ray o + t·d, `d` a unit vector, is walked from t0 to t1 one cell at a
 * time — a 3D DDA — and each cell's marks are hit EXACTLY, by the quadratic,
 * rather than sampled: a globe six pixels across would otherwise need a
 * step every pixel, and would still flicker. Coverage is accumulated front
 * to back and the walk stops when the ink is solid. `px` is the width of a
 * pixel at unit distance, so an edge is softened over the pixel it lands on
 * at its own depth — and a mark that is smaller than the pixel it lands on
 * is faded out altogether, because forty of them in a row along the ray
 * would otherwise sum to a haze that no single one of them is. Nothing is
 * drawn outside [t0, t1]: the shape's faces and the cut both section the
 * marks cleanly.
 */
export const HALFTONE_VOLUME_GLSL = /* glsl */`
const vec3 HT_A1 = vec3(0.81649658, 0.0, 0.57735027);
const vec3 HT_A2 = vec3(-0.40824829, 0.70710678, 0.57735027);
const vec3 HT_A3 = vec3(-0.40824829, -0.70710678, 0.57735027);
vec3 htToLattice(vec3 p) { return vec3(dot(p, HT_A1), dot(p, HT_A2), dot(p, HT_A3)); }
vec3 htFromLattice(vec3 q) { return q.x * HT_A1 + q.y * HT_A2 + q.z * HT_A3; }

float htValueAt(vec3 p);

/* Three numbers in [-1, 1] from a lattice point, the same every frame. */
vec3 htScatter(vec3 q) {
    vec3 h = fract(sin(vec3(
        dot(q, vec3(127.1, 311.7, 74.7)),
        dot(q, vec3(269.5, 183.3, 246.1)),
        dot(q, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
    return h * 2.0 - 1.0;
}

/* How much of a mark to count, by its size on the page at its depth. */
float htVisible(float r, float t, float px) {
    return smoothstep(0.35, 1.0, r / (px * max(t, 1e-4)));
}

float htRadius3(float v, int method) {
    v = clamp(v, 0.0, 1.0);
    if (v <= 0.003) return 0.0;
    if (method == 1) return 0.5 * sqrt(v);
    if (method == 2) return 0.5 * v;
    return 0.5 * (1.0 - sqrt(max(0.0, 1.0 - v)));
}

/* A globe at c: the ray's nearest approach, clamped to the cell's own span
   of the ray, against the radius. */
float htGlobe(vec3 o, vec3 d, vec3 c, float r, float t0, float t1, float px) {
    vec3 oc = c - o;
    float tc = dot(oc, d);
    float d2 = max(dot(oc, oc) - tc * tc, 0.0);
    float h = sqrt(max(r * r - d2, 0.0));
    if (tc + h <= t0 || tc - h >= t1) return 0.0;
    float tcl = clamp(tc, t0, t1);
    vec3 at = o + tcl * d;
    float dist = length(at - c);
    float aa = 0.5 * px * max(tcl, 1e-4) + 1e-6;
    return (1.0 - smoothstep(r - aa, r + aa, dist)) * htVisible(r, tcl, px);
}

/* A rod through c along the unit axis a, of radius r, as long as its cell:
   the same test in the plane across the rod. */
float htRod(vec3 o, vec3 d, vec3 c, vec3 a, float r, float t0, float t1, float px) {
    vec3 oc = o - c;
    vec3 dp = d - dot(d, a) * a;
    vec3 op = oc - dot(oc, a) * a;
    float A = dot(dp, dp);
    float B = dot(dp, op);
    float C = dot(op, op);
    float tc, d2;
    if (A < 1e-8) { tc = t0; d2 = C; }
    else { tc = -B / A; d2 = max(C - B * B / A, 0.0); }
    float h = A < 1e-8 ? 1e9 : sqrt(max(r * r - d2, 0.0) / A);
    if (tc + h <= t0 || tc - h >= t1) return 0.0;
    float tcl = clamp(tc, t0, t1);
    float dist = sqrt(max(A * tcl * tcl + 2.0 * B * tcl + C, 0.0));
    float aa = 0.5 * px * max(tcl, 1e-4) + 1e-6;
    return (1.0 - smoothstep(r - aa, r + aa, dist)) * htVisible(r, tcl, px);
}

float halftoneVolume(vec3 o, vec3 d, float t0, float t1, float cell, int method, float px) {
    if (t1 <= t0) return 0.0;
    vec3 lo = htToLattice(o) / cell;
    vec3 ld = htToLattice(d) / cell;
    /* A ray exactly along a lattice plane would divide by zero; nudged. */
    vec3 sg = sign(ld);
    sg += 1.0 - abs(sg);
    ld = sg * max(abs(ld), 1e-7);
    vec3 p = lo + t0 * ld;
    vec3 cellIdx = floor(p);
    vec3 tDelta = abs(1.0 / ld);
    vec3 next = t0 + (cellIdx + max(sg, 0.0) - p) / ld;

    float t = t0;
    float alpha = 0.0;
    for (int i = 0; i < 512; i++) {
        float tNext = min(min(next.x, next.y), next.z);
        float tOut = min(tNext, t1);
        vec3 c = htFromLattice((cellIdx + 0.5) * cell);
        float r = htRadius3(htValueAt(c), method) * cell;
        if (r > 0.0) {
            float cov;
            if (method == 1) {
                /* Off its point by what the cell has to spare, so the globe
                   still lies within the cell the walk is in. */
                c += htFromLattice(htScatter(cellIdx) * (0.5 * cell - r));
                cov = htGlobe(o, d, c, r, t, tOut, px);
            } else if (method == 2) {
                cov = htRod(o, d, c, HT_A3, r, t, tOut, px);
            } else {
                cov = htRod(o, d, c, HT_A1, r, t, tOut, px);
                cov = max(cov, htRod(o, d, c, HT_A2, r, t, tOut, px));
                cov = max(cov, htRod(o, d, c, HT_A3, r, t, tOut, px));
            }
            alpha += (1.0 - alpha) * cov;
            if (alpha > 0.985) { alpha = 1.0; break; }
        }
        if (tNext >= t1) break;
        if (next.x < next.y && next.x < next.z) { cellIdx.x += sg.x; next.x += tDelta.x; }
        else if (next.y < next.z) { cellIdx.y += sg.y; next.y += tDelta.y; }
        else { cellIdx.z += sg.z; next.z += tDelta.z; }
        t = tNext;
    }
    return alpha;
}
`;

/**
 * The uniforms every screened material carries, filled from the panel.
 *
 * @param {number} pixelRatio  device pixels per CSS pixel, for the glass
 * @param {number} worldPerPx  the scene's own units per CSS pixel at the
 *        framing the pane opens on, for the shape — see the head of the file
 */
export function halftoneUniforms(pixelRatio = window.devicePixelRatio || 1, worldPerPx = 0.01) {
    const ink = inkHex(), ground = groundHex();
    const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
    return {
        uHtMethod: { value: methodIndex() },
        uHtShape: { value: halftone.shape ? 1 : 0 },
        uHtCell: { value: Math.max(1, halftone.size) * pixelRatio },
        uHtCellWorld: { value: cellWorld(worldPerPx) },
        uHtInk: { value: rgb(ink) },
        uHtGround: { value: rgb(ground) },
    };
}

/** The pitch in a scene's own units, given what a CSS pixel is worth there. */
export function cellWorld(worldPerPx) {
    return Math.max(1, halftone.size) * Math.max(1e-6, worldPerPx);
}

/** Bring a material's screen uniforms up to date with the panel. */
export function syncHalftoneUniforms(material, pixelRatio = window.devicePixelRatio || 1, worldPerPx = 0.01) {
    const u = material && material.uniforms;
    if (!u || !u.uHtMethod) return;
    const fresh = halftoneUniforms(pixelRatio, worldPerPx);
    u.uHtMethod.value = fresh.uHtMethod.value;
    u.uHtShape.value = fresh.uHtShape.value;
    u.uHtCell.value = fresh.uHtCell.value;
    u.uHtCellWorld.value = fresh.uHtCellWorld.value;
    u.uHtInk.value = fresh.uHtInk.value;
    u.uHtGround.value = fresh.uHtGround.value;
}
