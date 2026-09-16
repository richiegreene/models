/* =====================================================================
 *  TRIADS — the topological pane
 * =====================================================================
 *
 * The triangle drawn flat: the field as a shaded ground, as contour lines, or
 * as both, with the JI lattice over it and the cursor on top.
 *
 * WHY A CANVAS AND NOT A PICTURE.  Isoharmonics asks matplotlib for a PNG and
 * blits it. That settles the colours, the contour count and the resolution at
 * generation time, so changing any of them means recomputing the model — and
 * it puts the dots in a different coordinate system from the image they sit
 * on, which is why that app has to hunt for the corners of its own triangle
 * with a convex hull before it can lift the thing into 3D. Here the field is
 * kept as numbers and every mark on this canvas — the shading, the lines, the
 * dots, the labels, the cursor — is placed from the same three-line mapping in
 * triad-geometry.js. Recolouring is a repaint, not a regeneration, and the
 * exporter can emit real vectors because it is drawing from the same numbers
 * rather than tracing a bitmap.
 * ------------------------------------------------------------------ */

import {
    fitTriangle, centsToShape, shapeToCents, clampCents, equaveCents,
    sampleField, normalise, insideTriangle, SQRT3_2,
} from './triad-geometry.js';
import {
    triadFill, triadLines, triadContours, triadLineWidth, triadDots, triadLabels,
    triadSnap, triadRelief, triadGloss, cursor,
} from './triad-state.js';
import { currentTriads, currentField, complexityRange } from './triad-surface.js';
import { currentLayoutMode } from '../globals.js';
import { colormapAt, lighting, isLightGround, groundCss, layoutSignature } from '../calculations/color-mapping.js';
import { halftone, halftoneOn, halftoneSignature, screenMarks, paintMarks, inkCss } from '../calculations/halftone.js';

/** The colour layout the whole app is currently set to. */
export function colormap() { return colormapAt(currentLayoutMode); }
/** Its ramp — what dots, contours and gradient shading are coloured by. */
export function colormapFn() { return colormap().ramp; }
/** Whether that layout's ground is light, which every other colour follows. */
export function onLight() { return isLightGround(colormap().ground); }
/** The ground itself — cream, blush and sage as readily as black or white. */
export function groundColor() { return colormap().ground; }
/** Its material, if it is a lit layout rather than a value-coloured one. */
export function colormapMaterial() { return colormap().material; }

let canvas = null;
let ctx = null;
let fit = null;
let onGesture = null;

/* The panel settings the last paint was made with. The pointer handlers need
   the equave to turn a pixel into a chord, and an event carries no arguments —
   so the drawer leaves them here rather than every caller passing them twice. */
let opts = { equaveRatio: 2, baseSize: 1, scalingFactor: 2, enableSize: true, enableColor: true };

/* The shaded ground, painted once per field-and-colormap at the field's own
   resolution and then scaled up. Repainting 150,000 pixels on every pointer
   move would cost more than everything else on the canvas together. */
let shade = null;
let shadeKey = '';

/* Contour segments in shape coordinates, likewise cached: marching squares
   over the whole grid is not a per-frame cost. */
let contours = null;
let contourKey = '';

/* The halftone's marks, cached the same way: a screen over the triangle at
   the pane's own size is some thousands of circles, read out of the field
   through the same bilinear sample the cursor uses. */
let marks = null;
let marksKey = '';

export function attach2D(el, gestureHandler) {
    canvas = el;
    ctx = canvas.getContext('2d');
    onGesture = gestureHandler;
    bindPointer();
    return { draw, resize, invalidate, hitTest, geometry: () => fit };
}

/** Throw the cached paint away — a new field, a new colormap, a new level. */
export function invalidate() { shadeKey = ''; contourKey = ''; marksKey = ''; }

/**
 * The screen over the field, as marks in pane pixels.
 *
 * Laid at the PANE's resolution rather than the field's: the shading is
 * painted at the field's own size and scaled up, which is right for a
 * continuous tone and wrong for a screen, whose whole point is dots of a
 * stated size on the page. Every cell reads the field at its centre, through
 * the same sample the cursor and the CSV read it with.
 */
export function buildMarks(field, fitted = fit) {
    const key = `${field.w}x${field.h}|${field.min}|${field.max}|${field.up}|${fitted.side}|${fitted.originX}|${fitted.originY}|${halftoneSignature()}|${halftone.size}`;
    if (key === marksKey && marks && fitted === fit) return marks;
    const [v0, v1, v2] = fitted.vertices();
    const xs = [v0[0], v1[0], v2[0]], ys = [v0[1], v1[1], v2[1]];
    const built = screenMarks(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (px, py) => {
        const [gx, gy] = fitted.toShape(px, py);
        /* A little past the edge, so the cut is made by the triangle's own
           antialiased path and not by a row of missing cells. */
        if (!insideTriangle(gx, gy, 0.01)) return NaN;
        const v = sampleField(field, gx, gy);
        return v === v ? normalise(field, v) : NaN;
    });
    if (fitted === fit) { marks = built; marksKey = key; }
    return built;
}

/* ---- the scratch layer the triangle is cut out of ----
   Kept between frames and only resized when the pane is, because allocating a
   full-size canvas every frame would cost more than the clip it replaces.
   Returns null if a 2D context cannot be had, and `draw` then falls back to
   the old hard clip — a staircase is worse than a picture, but both beat
   nothing on screen. */
let scratch = null, scratchCtx2 = null;

function scratchLayer(w, h) {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (!scratch) {
        scratch = document.createElement('canvas');
        scratchCtx2 = scratch.getContext('2d');
    }
    if (!scratchCtx2) return null;
    if (scratch.width !== pw || scratch.height !== ph) {
        scratch.width = pw; scratch.height = ph;
    }
    scratchCtx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    scratchCtx2.clearRect(0, 0, w, h);
    return scratchCtx2;
}

export function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fit = fitTriangle(w, h);
}

/* ---------------------------------------------------------------------
 *  The shaded ground
 * ------------------------------------------------------------------ */
function buildShade(field) {
    const key = `${field.w}x${field.h}|${layoutSignature(currentLayoutMode)}|${triadRelief}|${triadGloss}|${field.min}|${field.max}`;
    if (key === shadeKey && shade) return shade;

    const off = document.createElement('canvas');
    off.width = field.w;
    off.height = field.h;
    const octx = off.getContext('2d');
    const img = octx.createImageData(field.w, field.h);

    /* One painter for both kinds. A material layout has its base colour lit;
       a ramp layout has its base colour left exactly alone and only a highlight
       laid over it. See `lighting` in color-mapping.js. */
    paintField(field, img, lighting(colormap(), triadGloss));

    octx.putImageData(img, 0, 0);
    shade = off;
    shadeKey = key;
    return shade;
}

/* The light, in the flat pane. Up and to the left, which is the convention
   every relief map is read by — reverse it and the eye turns every summit
   into a pit. Kept in step with the key light in the lifted pane, so the two
   panes are the same surface under the same lamp. */
const LIGHT = (() => {
    const v = [-0.55, 0.62, 0.56];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
})();

/** The half-vector, with the eye directly overhead — fixed, so it is computed
 *  once rather than per cell. That is what makes a Blinn-Phong highlight cheap
 *  enough to run over every sample of the grid. */
const HALF = (() => {
    const v = [LIGHT[0], LIGHT[1] + 1, LIGHT[2]];
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
})();

const chan = (hex) => ({
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
});

/**
 * The field, painted.
 *
 * The flat pane's answer to the lifted one: the field's own slope at each cell
 * is a surface normal, and the normal is lit by the same lamp the 3D pane
 * uses. What that light is allowed to do depends on the layout:
 *
 *   a MATERIAL layout has one body colour, so shading it IS the picture — a
 *   ridge a ramp would flatten into a single band of colour shows up as a
 *   ridge, which is the whole reason for the layout.
 *
 *   a RAMP layout gets its colour from the value, and dimming that colour by
 *   the local slope would make the map lie about its own numbers. So its base
 *   is left exactly as it was and only the specular is added on top.
 *
 * Relief scales the gradient, so the Display drawer's one control governs how
 * pronounced the surface is in BOTH panes, and Gloss scales the highlight.
 */
export function paintField(field, img, lit) {
    const map = colormapFn();
    const body = chan(lit.color);
    const spec = chan(lit.specular);
    /* The range is read through normalise(), which also turns an entropy the
       right way up; nothing here needs the span itself. */
    /* The gradient is per-cell, so a coarse grid has bigger steps for the same
       surface — normalising by the cell width keeps the lighting the same at
       every resolution. */
    const scale = (triadRelief * field.w) / 3;
    const needsLight = lit.material || lit.strength > 0.001;

    const at = (x, y) => {
        const cx = Math.min(field.w - 1, Math.max(0, x));
        const cy = Math.min(field.h - 1, Math.max(0, y));
        const v = field.z[cy * field.w + cx];
        return v === v ? normalise(field, v) : NaN;
    };

    for (let y = 0; y < field.h; y++) {
        // Row 0 of the field is the baseline; row 0 of an image is the top.
        const row = field.h - 1 - y;
        for (let x = 0; x < field.w; x++) {
            const o = (y * field.w + x) * 4;
            const c = at(x, row);
            if (!(c === c)) { img.data[o + 3] = 0; continue; }

            let br, bg, bb;
            if (lit.material) {
                br = body.r; bg = body.g; bb = body.b;
            } else {
                const col = map(c);
                br = col.r; bg = col.g; bb = col.b;
            }

            if (needsLight) {
                /* Central differences, falling back to the centre where a
                   neighbour is outside the triangle — otherwise every boundary
                   cell would light as a cliff. */
                const l = at(x - 1, row), r = at(x + 1, row);
                const d = at(x, row - 1), u = at(x, row + 1);
                const dx = ((r === r ? r : c) - (l === l ? l : c)) * 0.5 * scale;
                const dy = ((u === u ? u : c) - (d === d ? d : c)) * 0.5 * scale;

                let nx = -dx, ny = 1, nz = -dy;
                const nl = Math.hypot(nx, ny, nz);
                nx /= nl; ny /= nl; nz /= nl;

                if (lit.material) {
                    const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
                    const diffuse = lit.ambient + (1 - lit.ambient) * lambert;
                    br *= diffuse; bg *= diffuse; bb *= diffuse;
                }

                const highlight = Math.pow(
                    Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), lit.shininess);
                br += spec.r * highlight;
                bg += spec.g * highlight;
                bb += spec.b * highlight;
            }

            img.data[o] = Math.round(255 * Math.min(1, br));
            img.data[o + 1] = Math.round(255 * Math.min(1, bg));
            img.data[o + 2] = Math.round(255 * Math.min(1, bb));
            img.data[o + 3] = 255;
        }
    }
    bleedEdge(img, field.w, field.h);
}

/**
 * Carry the edge colour one cell out into the empty ground around it.
 *
 * The field is a rectangle with the triangle stamped out of it, and everything
 * outside is left fully transparent. That image is then drawn scaled up to the
 * pane and smoothed, and smoothing does not know the difference between a
 * colour and a hole: along the two slanted edges it mixes each border cell
 * with the transparent nothing beside it, so the outermost band of the picture
 * fades out and the ground shows through it. At field resolution that band is
 * a whole cell wide, which is what made the slants look eaten away while the
 * baseline — where the mask lands on a grid row and there is nothing to mix
 * with — stayed clean.
 *
 * So the transparent cells that touch the picture are given their neighbour's
 * colour and made opaque. They are still outside the triangle and are still
 * cut off by the mask in `draw`; they exist only so that the interpolation has
 * something of the right colour to reach for. One cell is enough because the
 * smoothing is bilinear, and bilinear never reaches past the adjacent texel.
 */
function bleedEdge(img, w, h) {
    const d = img.data;
    const src = new Uint8ClampedArray(d);      // read from the unbled copy
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            if (src[o + 3]) continue;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const p = (ny * w + nx) * 4;
                if (!src[p + 3]) continue;
                d[o] = src[p]; d[o + 1] = src[p + 1]; d[o + 2] = src[p + 2];
                d[o + 3] = 255;
                break;
            }
        }
    }
}

/* ---------------------------------------------------------------------
 *  Contours
 *
 *  Marching squares, in shape coordinates so a resize is free. Cells with a
 *  NaN corner are skipped outright rather than being given a fill value: the
 *  edge of the triangle is a cliff in the data, and a level line traced across
 *  it would be an artefact of the mask rather than a contour of the model.
 * ------------------------------------------------------------------ */
function buildContours(field, levels) {
    const key = `${field.w}x${field.h}|${levels}|${field.min}|${field.max}`;
    if (key === contourKey && contours) return contours;

    const segs = [];
    const span = field.max - field.min;
    if (!(span > 1e-12)) { contours = segs; contourKey = key; return segs; }

    const sx = 1 / (field.w - 1);
    const sy = 1 / (field.h - 1);

    for (let l = 1; l <= levels; l++) {
        const t = field.min + (span * l) / (levels + 1);
        for (let y = 0; y < field.h - 1; y++) {
            for (let x = 0; x < field.w - 1; x++) {
                const a = field.z[y * field.w + x];
                const b = field.z[y * field.w + x + 1];
                const c = field.z[(y + 1) * field.w + x + 1];
                const d = field.z[(y + 1) * field.w + x];
                if (!(a === a && b === b && c === c && d === d)) continue;

                const code = (a > t ? 1 : 0) | (b > t ? 2 : 0) | (c > t ? 4 : 0) | (d > t ? 8 : 0);
                if (code === 0 || code === 15) continue;

                const lerp = (p, q) => (t - p) / (q - p);
                const bottom = () => [(x + lerp(a, b)) * sx, y * sy];
                const right = () => [(x + 1) * sx, (y + lerp(b, c)) * sy];
                const top = () => [(x + lerp(d, c)) * sx, (y + 1) * sy];
                const left = () => [x * sx, (y + lerp(a, d)) * sy];

                /* The fifth number is where the level sits on the colormap,
                   1 the most concordant — so an entropy's levels are counted
                   from the other end. */
                const push = (p, q) => segs.push(p[0], p[1], q[0], q[1],
                    field.up < 0 ? 1 - l / (levels + 1) : l / (levels + 1));

                switch (code) {
                    case 1: case 14: push(left(), bottom()); break;
                    case 2: case 13: push(bottom(), right()); break;
                    case 3: case 12: push(left(), right()); break;
                    case 4: case 11: push(right(), top()); break;
                    case 6: case 9: push(bottom(), top()); break;
                    case 7: case 8: push(left(), top()); break;
                    /* The two saddles. Split them the same way every time —
                       either choice is defensible and an inconsistent one
                       leaves the map with contours that cross. */
                    case 5: push(left(), bottom()); push(right(), top()); break;
                    case 10: push(left(), top()); push(bottom(), right()); break;
                }
            }
        }
    }
    contours = segs;
    contourKey = key;
    return segs;
}

/* ---------------------------------------------------------------------
 *  The lattice
 * ------------------------------------------------------------------ */

/** Isoharmonics' rule: a longer label is drawn smaller, so the map stays legible. */
function labelSize(label) {
    const digits = Math.max(3, (label.match(/\d/g) || []).length);
    return Math.max(4.5, 11 * Math.pow(0.79370046571, digits - 3));
}

function triadColor(t, range, enableColor, scaling) {
    if (halftoneOn()) return inkCss();
    if (!enableColor) return onLight() ? '#111' : '#fff';
    const span = range.hi - range.lo;
    const norm = span > 1e-12 ? (t.complexity - range.lo) / span : 0.5;
    const v = Math.min(1, Math.max(0, (1 - norm) * (scaling / 2)));
    const c = colormapFn()(v);
    return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
}

/* ---------------------------------------------------------------------
 *  Drawing
 * ------------------------------------------------------------------ */

/**
 * @param {object} o  the settings the drawer reads out of the panel:
 *        equaveRatio, enableSize, enableColor, baseSize, scalingFactor
 */
export function draw(o) {
    if (!ctx || !fit) return;
    opts = o;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const light = onLight();

    ctx.clearRect(0, 0, w, h);
    /* The layout's own ground, not a black-or-white guess: the bright ones
       sit on tinted paper, and a pane painted hard white behind them would
       show the tint as a rectangle floating on a lamp. */
    ctx.fillStyle = groundCss(groundColor());
    ctx.fillRect(0, 0, w, h);

    const [v0, v1, v2] = fit.vertices();
    const path = new Path2D();
    path.moveTo(v0[0], v0[1]); path.lineTo(v1[0], v1[1]); path.lineTo(v2[0], v2[1]); path.closePath();

    const field = currentField();

    /* ---- the shading, cut to the triangle ----
     *
     * Through a scratch layer and `destination-in` rather than through
     * `ctx.clip`. A canvas clip is a hard per-pixel test — a pixel is in or it
     * is out, with nothing in between — so a clipped edge that does not lie
     * along a pixel row comes out as a staircase. A FILL of the same path is
     * antialiased, and using that fill as the layer's alpha gives the two
     * slanted edges the partial coverage they should have had.
     *
     * The contours go in the same layer: they are marks on the surface, and
     * they have to stop where it stops.
     */
    const layer = scratchLayer(w, h);
    const g = layer || ctx;
    if (!layer) { ctx.save(); ctx.clip(path); }

    if (field && triadFill && halftoneOn()) {
        /* The screen, in the ink: the one layout that is geometry rather
           than a picture, and cut by the same path the picture would be. */
        paintMarks(g, buildMarks(field));
    } else if (field && triadFill) {
        const img = buildShade(field);
        g.imageSmoothingEnabled = true;
        g.drawImage(img, fit.originX, fit.originY - fit.side * SQRT3_2,
                    fit.side, fit.side * SQRT3_2);
    } else if (halftoneOn()) {
        /* No plate under a screened picture: the ground IS the page. */
    } else if (!(field && triadLines)) {
        /* A plain ground, dark or light with the layout, so the lattice keeps
           the contrast it was coloured for.
         *
         * NOT WHEN THE LINES ARE THE PICTURE.  Lines without Fill is a
         * drawing of the field and nothing else, so it is given nothing to
         * sit on: no plate, and the pane's own ground showing through. The
         * contours hover, which is the point — the cost is that a line whose
         * value lands on the ground's own colour disappears into it, and that
         * is accepted rather than worked around, because papering over it
         * means putting the plate back. */
        g.fillStyle = light ? '#f2f3f6' : '#0b0c10';
        g.fill(path);
    }

    if (field && triadLines) {
        const segs = buildContours(field, triadContours);
        const map = colormapFn();
        g.lineWidth = triadLineWidth;
        for (let i = 0; i < segs.length; i += 5) {
            const c = map(segs[i + 4]);
            /* In the ink, and all of it, when the picture is a screen: a
               thirty-percent line on a page of one ink is a grey the page
               has otherwise nowhere. */
            g.strokeStyle = halftoneOn() ? inkCss()
                : triadFill
                ? `rgba(${light ? '0,0,0' : '255,255,255'},0.30)`
                : `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
            const p0 = fit.toPx(segs[i], segs[i + 1]);
            const p1 = fit.toPx(segs[i + 2], segs[i + 3]);
            g.beginPath();
            g.moveTo(p0[0], p0[1]);
            g.lineTo(p1[0], p1[1]);
            g.stroke();
        }
    }

    if (layer) {
        /* The path fill IS the alpha: antialiased, so the slants get partial
           coverage instead of a staircase. */
        layer.globalCompositeOperation = 'destination-in';
        layer.fillStyle = '#fff';
        layer.fill(path);
        layer.globalCompositeOperation = 'source-over';
        ctx.drawImage(scratch, 0, 0, w, h);
    } else {
        ctx.restore();
    }

    /* No outline. The shading is clipped to the path, so the triangle reads
       as a shape by its own edge — a stroke around it was a frame around a
       picture that already had one. */

    drawLattice(o);
    drawCursor(o);
}

function drawLattice(o) {
    if (!triadDots && !triadLabels) return;
    const triads = currentTriads();
    if (!triads.length) return;

    const E = equaveCents(o.equaveRatio);
    const range = complexityRange();
    const span = range.hi - range.lo;
    const base = Math.max(1.2, 3.6 * o.baseSize);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* As faint as the panel asks — Complexity channels › Opacity — so the
       lattice can sit lightly over the field it is marking. */
    const alpha = o.latticeOpacity ?? 1;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    for (const t of triads) {
        if (t.c1 + t.c2 > E + 1e-6) continue;
        const { gx, gy } = centsToShape(t.c1, t.c2, E);
        const [x, y] = fit.toPx(gx, gy);
        const color = triadColor(t, range, o.enableColor, o.scalingFactor);

        if (triadDots) {
            let r = base;
            if (o.enableSize) {
                const norm = span > 1e-12 ? (t.complexity - range.lo) / span : 0.5;
                r = base * (1 + (1 - norm) * (o.scalingFactor - 1));
            }
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
            ctx.fill();
        }

        if (triadLabels) {
            const size = labelSize(t.label) * o.baseSize;
            if (size < 4) continue;
            ctx.font = `${size.toFixed(1)}px monospace`;
            ctx.fillStyle = color;
            ctx.fillText(t.label, x, triadDots ? y - base - size * 0.6 : y);
        }
    }
    ctx.restore();
}

function drawCursor(o) {
    if (!cursor.live) return;
    const E = equaveCents(o.equaveRatio);
    const { gx, gy } = centsToShape(cursor.c1, cursor.c2, E);
    const [x, y] = fit.toPx(gx, gy);
    const ink = halftoneOn() ? inkCss() : onLight() ? '#111' : '#fff';

    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 11);
    ctx.stroke();
}

/* ---------------------------------------------------------------------
 *  The gesture
 *
 *  Pointer events rather than mouse events, and with capture: a drag that
 *  leaves the canvas keeps sounding and keeps being followed, so running off
 *  the edge slides along it instead of cutting the note off. Isoharmonics
 *  stops the sound the moment the pointer leaves the triangle, which makes the
 *  edges of the map unplayable.
 * ------------------------------------------------------------------ */
function bindPointer() {
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        canvas.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        onGesture?.('down', locate(ev));
    });

    canvas.addEventListener('pointermove', (ev) => {
        if (!canvas.hasPointerCapture?.(ev.pointerId)) return;
        ev.preventDefault();
        onGesture?.('move', locate(ev));
    });

    const up = (ev) => {
        if (!canvas.hasPointerCapture?.(ev.pointerId)) return;
        canvas.releasePointerCapture(ev.pointerId);
        onGesture?.('up', null);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
}

/** Where a pointer event is, in cents, clamped into the triangle. */
function locate(ev) {
    const r = canvas.getBoundingClientRect();
    return hitTest(ev.clientX - r.left, ev.clientY - r.top);
}

/**
 * A point in this pane's pixels, as a chord.
 *
 * Snapping is done in PIXELS rather than in cents so that it means the same
 * thing wherever you are on the triangle and whatever the equave is: the
 * question a hand is asking is "am I near that dot", and a dot is a fixed size
 * on screen.
 */
export function hitTest(px, py, o = opts) {
    if (!fit) return null;
    const [gx, gy] = fit.toShape(px, py);
    const E = equaveCents(o?.equaveRatio ?? 2);
    const raw = shapeToCents(gx, gy, E);
    const c = clampCents(raw.c1, raw.c2, E);

    if (triadSnap > 0 && (triadDots || triadLabels)) {
        const snapped = nearestTriad(px, py, E);
        if (snapped) return { ...snapped, snapped: true };
    }
    return { c1: c.c1, c2: c.c2, label: null, snapped: false };
}

function nearestTriad(px, py, E) {
    const triads = currentTriads();
    let best = null, bestD2 = triadSnap * triadSnap;
    for (const t of triads) {
        if (t.c1 + t.c2 > E + 1e-6) continue;
        const { gx, gy } = centsToShape(t.c1, t.c2, E);
        const [x, y] = fit.toPx(gx, gy);
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (d2 <= bestD2) { bestD2 = d2; best = t; }
    }
    return best ? { c1: best.c1, c2: best.c2, label: best.label } : null;
}

/** The cached contour segments, for the SVG exporter. */
export function contourSegments(field, levels) {
    return field ? buildContours(field, levels) : [];
}
