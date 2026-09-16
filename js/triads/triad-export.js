/* =====================================================================
 *  TRIADS — what leaves the app
 * =====================================================================
 *
 * WHAT IS A VECTOR AND WHAT IS NOT, AND WHY.  A scalar field shaded
 * continuously is not vector art: drawn honestly it is one polygon per grid
 * cell, which is a hundred thousand paths that no editor will open. So the
 * shading — and only the shading — goes in as an embedded image, clipped to
 * the triangle, at the model's own resolution. Everything drawn ON it stays
 * real vectors: the contour lines are paths, the lattice is circles, the
 * labels are text you can restyle, and the triangle is a closed polygon. That
 * is the opposite way round from Isoharmonics, which flattens the whole
 * picture — dots, labels and all — into a single embedded PNG and calls the
 * file .svg.
 *
 * Turn Fill off and Lines on and the export is vectors end to end.
 * ------------------------------------------------------------------ */

import {
    fitTriangle, centsToShape, equaveCents, SQRT3_2,
} from './triad-geometry.js';
import {
    triadFill, triadLines, triadContours, triadLineWidth, triadDots, triadLabels, triadView, triadGloss,
} from './triad-state.js';
import { currentTriads, currentField, currentFieldModel, complexityRange } from './triad-surface.js';
import { colormap, colormapFn, onLight, groundColor, contourSegments, paintField, buildMarks } from './triad-2d.js';
import { halftoneOn, inkCss, marksToSvg } from '../calculations/halftone.js';
import { domElement as gl3d, frameTight, restoreFrame } from './triad-3d.js';
import { groundCss, lighting } from '../calculations/color-mapping.js';
import { downloadSVG, downloadCSV, simplifyFraction } from '../utils/data-export.js';
import { readPanel } from './triad-mode.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
};
const f = (n) => (Math.round(n * 100) / 100).toString();

/** The lifted pane, read back at whatever crop frameTight can manage — see
 *  triad-3d.js — rather than the live view's own looser fit, so the exported
 *  file is the surface filling the frame instead of a screenshot of it. */
function capture3D(filename) {
    const canvas = gl3d();
    if (!canvas) return;
    const saved = frameTight();
    canvas.toBlob((blob) => {
        restoreFrame(saved);
        if (blob) drop(blob, filename);
    }, 'image/png');
}

/** The field as a data URI, at the resolution it was computed at.
 *
 *  Painted through the same lighting the on-screen pane uses — see
 *  paintField in triad-2d.js — so Relief and Gloss leave the file looking
 *  like what was on screen rather than the flat, unlit colour ramp. */
function fieldImage(field) {
    const c = document.createElement('canvas');
    c.width = field.w;
    c.height = field.h;
    const g = c.getContext('2d');
    const img = g.createImageData(field.w, field.h);
    paintField(field, img, lighting(colormap(), triadGloss));
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
}

function labelSize(label) {
    const digits = Math.max(3, (label.match(/\d/g) || []).length);
    return Math.max(4.5, 11 * Math.pow(0.79370046571, digits - 3));
}

/** The flat pane, as an SVG document. */
export function exportTriadSVG() {
    const o = readPanel();
    const pane = document.getElementById('triad-topo-pane');
    const width = (pane && pane.clientWidth) || 900;
    const height = (pane && pane.clientHeight) || 780;
    const fit = fitTriangle(width, height);
    const light = onLight();
    const ink = halftoneOn() ? inkCss() : light ? '#111111' : '#ffffff';

    const svg = el('svg', {
        xmlns: NS, 'xmlns:xlink': 'http://www.w3.org/1999/xlink',
        width, height, viewBox: `0 0 ${width} ${height}`,
    });
    svg.appendChild(el('rect', {
        x: 0, y: 0, width, height, fill: groundCss(groundColor()),
    }));

    const [v0, v1, v2] = fit.vertices();
    const points = `${f(v0[0])},${f(v0[1])} ${f(v1[0])},${f(v1[1])} ${f(v2[0])},${f(v2[1])}`;

    const defs = el('defs');
    const clip = el('clipPath', { id: 'tri' });
    clip.appendChild(el('polygon', { points }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    const field = currentField();
    const clipped = el('g', { 'clip-path': 'url(#tri)' });

    if (field && triadFill && halftoneOn()) {
        /* The screen as vectors — every dot a circle, every hatch a path —
           which is the whole reason a halftone is worth having in a file: it
           is the one shading of a field that is not a raster. */
        clipped.appendChild(marksToSvg(el, f, buildMarks(field, fit)));
    } else if (field && triadFill) {
        const img = el('image', {
            x: f(fit.originX),
            y: f(fit.originY - fit.side * SQRT3_2),
            width: f(fit.side),
            height: f(fit.side * SQRT3_2),
            preserveAspectRatio: 'none',
        });
        /* The one raster in the file, and the only thing in the picture that
           genuinely is one. Everything drawn over it stays vector. */
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', fieldImage(field));
        img.setAttribute('href', fieldImage(field));
        clipped.appendChild(img);
    } else if (!(field && triadLines) && !halftoneOn()) {
        /* No plate under a lines-only picture, matching the pane — see draw in
           triad-2d.js. The file is then contours on the page's own ground,
           which is what was on screen. Nor under a screened one. */
        clipped.appendChild(el('polygon', { points, fill: light ? '#f2f3f6' : '#0b0c10' }));
    }

    if (field && triadLines) {
        const segs = contourSegments(field, triadContours);
        const map = colormapFn();
        /* One path per level rather than per segment: an editor opening this
           wants twenty-four contours it can select, not nine thousand
           two-point lines. */
        const byLevel = new Map();
        for (let i = 0; i < segs.length; i += 5) {
            const key = segs[i + 4];
            if (!byLevel.has(key)) byLevel.set(key, []);
            const a = fit.toPx(segs[i], segs[i + 1]);
            const b = fit.toPx(segs[i + 2], segs[i + 3]);
            byLevel.get(key).push(`M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`);
        }
        for (const [level, d] of byLevel) {
            const c = map(level);
            clipped.appendChild(el('path', {
                d: d.join(''),
                fill: 'none',
                'stroke-width': f(triadLineWidth),
                stroke: halftoneOn() ? inkCss()
                    : triadFill ? ink : `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`,
                'stroke-opacity': triadFill && !halftoneOn() ? 0.3 : 1,
            }));
        }
    }
    svg.appendChild(clipped);

    if (triadDots || triadLabels) {
        const E = equaveCents(o.equaveRatio);
        const range = complexityRange();
        const span = range.hi - range.lo;
        const base = Math.max(1.2, 3.6 * o.baseSize);
        const dots = el('g');
        const names = el('g', { 'font-family': 'monospace', 'text-anchor': 'middle' });

        for (const t of currentTriads()) {
            if (t.c1 + t.c2 > E + 1e-6) continue;
            const { gx, gy } = centsToShape(t.c1, t.c2, E);
            const [x, y] = fit.toPx(gx, gy);
            const norm = span > 1e-12 ? (t.complexity - range.lo) / span : 0.5;
            let fill = ink;
            if (o.enableColor) {
                const c = colormapFn()(Math.min(1, Math.max(0, (1 - norm) * (o.scalingFactor / 2))));
                fill = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
            }
            if (triadDots) {
                const r = o.enableSize ? base * (1 + (1 - norm) * (o.scalingFactor - 1)) : base;
                dots.appendChild(el('circle', { cx: f(x), cy: f(y), r: f(Math.max(0.6, r)), fill }));
            }
            if (triadLabels) {
                const size = labelSize(t.label) * o.baseSize;
                if (size < 4) continue;
                const text = el('text', {
                    x: f(x), y: f(triadDots ? y - base - size * 0.6 : y),
                    'font-size': f(size), fill, 'dominant-baseline': 'middle',
                });
                text.textContent = t.label;
                names.appendChild(text);
            }
        }
        svg.appendChild(dots);
        svg.appendChild(names);
    }

    return new XMLSerializer().serializeToString(svg);
}

export function saveTriadSVG() {
    if (triadView === '3d') {
        /* A lifted surface has no honest vector form — it is a shaded mesh
           under a perspective camera. Saying so is better than emitting a
           .svg with a screenshot inside it. */
        saveTriadPNG('triads-3d.png');
        return;
    }
    downloadSVG(exportTriadSVG(), 'triads-export.svg');
    /* Both panes up: the flat one just left as a real vector file, but the
       lifted one beside it is still on screen and would otherwise vanish
       from the export entirely. Same raw-canvas readback saveTriadPNG uses
       below, just not bundled with a second copy of the flat pane. */
    if (triadView === 'both') capture3D('triads-3d.png');
}

/**
 * The picture, rasterised.
 *
 * The flat pane goes through the SVG above so that print size is a real
 * choice; the lifted pane is the GL canvas itself, which is why its renderer
 * is built with preserveDrawingBuffer — without it the buffer is already
 * cleared by the time anything can read it.
 */
export function saveTriadPNG(filename = 'triads-export.png') {
    if (triadView === '3d' || triadView === 'both') {
        capture3D(filename);
        if (triadView === '3d') return;
    }

    const pane = document.getElementById('triad-topo-pane');
    const width = (pane && pane.clientWidth) || 900;
    const height = (pane && pane.clientHeight) || 780;
    const MAX_SIDE = 12000, MAX_AREA = 60e6;
    const scale = Math.max(1, Math.min(4, MAX_SIDE / width, MAX_SIDE / height,
                                       Math.sqrt(MAX_AREA / (width * height))));

    const url = URL.createObjectURL(new Blob([exportTriadSVG()], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = groundCss(groundColor());
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => { if (blob) drop(blob, filename); }, 'image/png');
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        console.error('PNG export could not rasterise the triangle.');
    };
    image.src = url;
}

function drop(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

/**
 * The set itself.
 *
 * The tetrad CSV's columns, over three voices — and one column more, because a
 * triad in Triads mode has a height as well as a place: where the current
 * model puts it says how concordant this chord is under that model, which is
 * the number the whole mode exists to look at.
 */
export function exportTriadCSV() {
    const triads = currentTriads();
    if (!triads.length) { console.warn('No triads to export.'); return; }

    const select = document.getElementById('complexityMethod');
    const measure = select.options[select.selectedIndex].text;
    const o = readPanel();
    const E = equaveCents(o.equaveRatio);
    const field = currentField();
    const model = currentFieldModel();

    const rows = triads.slice().sort((a, b) => a.complexity - b.complexity).map((t) => {
        const parts = t.label.split(':').map(Number);
        const notes = parts.map((p) => simplifyFraction(p, parts[0])).join(' ');
        const cents = parts.map((p) => Math.round(1200 * Math.log2(p / parts[0]))).join(' ');
        let value = '';
        if (field) {
            const { gx, gy } = centsToShape(t.c1, t.c2, E);
            const v = sample(field, gx, gy);
            value = v === v ? v.toFixed(4) : '';
        }
        return `${t.label},"${notes}","${cents}",${t.complexity}${field ? ',' + value : ''}`;
    });

    const header = `Chord,Notes,Cents,${measure}` + (field ? `,${model === 'he' ? 'HarmonicEntropy(nats)' : 'Sethares'}` : '');
    downloadCSV([header, ...rows].join('\n'), 'triads-export.csv');
}

/**
 * The model's value at one chord.
 *
 * A nearest-sample read rather than a bilinear one: the CSV wants the value AT
 * the chord, and a blend of four cells is a statement about its neighbourhood.
 *
 * The widening search is for the edges. A triad like 2:3:4 sits exactly on the
 * triangle's hypotenuse, and both the rasterised mask and the interpolation
 * behind the Sethares model can leave the very boundary cell empty — so the
 * chords most worth naming would be the ones with a blank in the column.
 * Rather than report nothing for them, the nearest cell that does have a value
 * is taken, which for a boundary chord is a pixel away.
 */
function sample(field, gx, gy) {
    const cx = Math.round(gx * (field.w - 1));
    const cy = Math.round(gy * (field.h - 1));

    for (let r = 0; r <= 3; r++) {
        let sum = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = cx + dx, y = cy + dy;
                if (x < 0 || y < 0 || x >= field.w || y >= field.h) continue;
                const v = field.z[y * field.w + x];
                if (v === v) { sum += v; n++; }
            }
        }
        if (n) return sum / n;
    }
    return NaN;
}
