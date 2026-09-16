/* =====================================================================
 *  DYADS — what leaves the app
 * =====================================================================
 *
 * VECTORS END TO END, WITH NOTHING EMBEDDED.  The triangle's exporter has to
 * put its shading in as a raster, and says why: a scalar field shaded
 * continuously is one polygon per grid cell, which is a hundred thousand paths
 * no editor will open. A curve has no such problem. The shading under it is a
 * band a few hundred columns wide, which is a linear gradient — one element,
 * sampled from the very colormap the pane paints with — and everything else is
 * a path, a circle or real text.
 *
 * So a .svg saved from this mode contains no image at any resolution. It can
 * be printed at any size, recoloured in an editor, and its curve can be
 * selected as the single path it actually is.
 * ------------------------------------------------------------------ */

import { fitPlot, axisCents, centsTicks, valueAtCents } from './dyad-geometry.js';
import {
    dyadFill, dyadLine, dyadLineWidth, dyadGrid, dyadDots, dyadLabels, dyadSpan,
} from './dyad-state.js';
import { currentDyads, currentCurve, currentCurveModel, complexityRange } from './dyad-curve.js';
import { colormapFn, onLight, groundColor, verticalAxis, marksAreLegible } from './dyad-2d.js';
import { groundCss } from '../calculations/color-mapping.js';
import { downloadSVG, downloadCSV, simplifyFraction } from '../utils/data-export.js';
import { readPanel } from '../utils/read-panel.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
};
const f = (n) => (Math.round(n * 100) / 100).toString();
const rgbOf = (c) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;

function labelSize(label) {
    const digits = Math.max(3, (label.match(/\d/g) || []).length);
    return Math.max(4.5, 11 * Math.pow(0.79370046571, digits - 3));
}

/** The pane, as an SVG document. */
export function exportDyadSVG() {
    const o = readPanel();
    const pane = document.getElementById('dyad-pane');
    const width = (pane && pane.clientWidth) || 1100;
    const height = (pane && pane.clientHeight) || 640;
    /* The same margins the pane is using, so the file is a picture of what is
       on screen rather than of what the plot would look like with furniture it
       has been told not to draw. */
    const fit = dyadGrid ? fitPlot(width, height)
                         : fitPlot(width, height, { padL: 18, padR: 18, padT: 18, padB: 18 });
    const light = onLight();
    const ink = light ? '#111111' : '#ffffff';
    const inkA = (a) => (light ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);

    const C = axisCents(o.equaveRatio, dyadSpan);
    const axis = verticalAxis(o);
    const curve = currentCurve();

    const svg = el('svg', {
        xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}`,
    });
    svg.appendChild(el('rect', { x: 0, y: 0, width, height, fill: groundCss(groundColor()) }));

    /* ---- the ruler ----
       All of it, or none of it: see dyadGrid in dyad-state.js. */
    if (dyadGrid) {
        const grid = el('g');
        const { step, ticks } = centsTicks(C);
        const marks = el('g', { 'font-family': 'sans-serif', 'font-size': 10, fill: inkA(0.55) });
        ticks.forEach((c, i) => {
            const [x] = fit.toPx(c / C, 0);
            const major = i % 3 === 0;
            grid.appendChild(el('line', {
                x1: f(x), y1: f(fit.y0), x2: f(x), y2: f(fit.y1),
                stroke: inkA(major ? 0.16 : 0.08),
            }));
            if (major || step >= 200) {
                const t = el('text', { x: f(x), y: f(fit.y0 + 16), 'text-anchor': 'middle' });
                t.textContent = String(Math.round(c));
                marks.appendChild(t);
            }
        });
        /* Dropped rather than overprinted once Relief has brought the two ends
           of the axis within the height of the words themselves — see
           marksAreLegible in dyad-2d.js. */
        if (marksAreLegible(axis, fit)) {
            for (const [v, label] of axis.ticks) {
                const [, y] = fit.toPx(0, axis.lift(v));
                if (y < fit.y1 - 1 || y > fit.y0 + 1) continue;
                const t = el('text', {
                    x: f(fit.x0 + 6), y: f(y + 3 + (v > 0.5 ? 9 : -9)), 'text-anchor': 'start',
                });
                t.textContent = label;
                marks.appendChild(t);
            }
        }
        const cents = el('text', {
            x: f((fit.x0 + fit.x1) / 2), y: f(fit.y0 + 33), 'text-anchor': 'middle',
        });
        cents.textContent = 'cents';
        marks.appendChild(cents);
        const vt = el('text', {
            x: 0, y: 0, 'text-anchor': 'middle',
            transform: `translate(14 ${f((fit.y0 + fit.y1) / 2)}) rotate(-90)`,
        });
        vt.textContent = axis.title;
        marks.appendChild(vt);
        svg.appendChild(grid);
        svg.appendChild(marks);
    }

    /* ---- the curve ---- */
    const yFloor = fit.y0 - axis.floor * (fit.y0 - fit.y1);
    if (curve) {
        const cols = Math.max(2, Math.round(fit.x1 - fit.x0));
        const pts = [];
        const vals = [];
        for (let i = 0; i < cols; i++) {
            const v = axis.at((i / (cols - 1)) * C);
            vals.push(v);
            const h = axis.lift(Math.min(1, Math.max(0, v === v ? v : 0)));
            pts.push(`${f(fit.x0 + i)} ${f(fit.y0 - h * (fit.y0 - fit.y1))}`);
        }
        const line = 'M' + pts.join('L');

        /* The one gradient in the file, and both marks are painted with it:
           the shading under the curve and the curve itself are the same
           measure read at the same places, so a second gradient could only be
           the same one twice or the same one wrong. userSpaceOnUse rather than
           the default bounding box, because the fill's box and the stroke's
           box are not identical and a proportional gradient would land the
           two of them a pixel apart.

           256 stops rather than the 64 this started with: a flat fill can
           afford a coarse ramp, but a stroke a few pixels wide IS the ramp,
           and a spike narrower than a stop would take its colour from its
           neighbour. */
        if (dyadFill || dyadLine) {
            const map = colormapFn();
            const defs = el('defs');
            const grad = el('linearGradient', {
                id: 'dyad-ramp', gradientUnits: 'userSpaceOnUse',
                x1: f(fit.x0), y1: '0', x2: f(fit.x1), y2: '0',
            });
            const STOPS = Math.max(2, Math.min(cols - 1, 256));
            for (let s = 0; s <= STOPS; s++) {
                const i = Math.round((s / STOPS) * (cols - 1));
                const v = Math.min(1, Math.max(0, vals[i] === vals[i] ? vals[i] : 0));
                grad.appendChild(el('stop', {
                    offset: `${((s / STOPS) * 100).toFixed(3)}%`,
                    'stop-color': rgbOf(map(v)),
                }));
            }
            defs.appendChild(grad);
            svg.appendChild(defs);
        }

        if (dyadFill) {
            svg.appendChild(el('path', {
                d: `${line}L${f(fit.x1)} ${f(yFloor)}L${f(fit.x0)} ${f(yFloor)}Z`,
                fill: 'url(#dyad-ramp)', stroke: 'none',
            }));
        }
        if (dyadLine) {
            /* Through the ramp whether or not there is a fill under it — see
               drawCurve in dyad-2d.js, which this is a picture of. */
            svg.appendChild(el('path', {
                d: line, fill: 'none',
                stroke: 'url(#dyad-ramp)',
                'stroke-width': f(dyadLineWidth),
                'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            }));
        }
    }

    if (dyadGrid) {
        svg.appendChild(el('rect', {
            x: f(fit.x0), y: f(fit.y1), width: f(fit.x1 - fit.x0), height: f(fit.y0 - fit.y1),
            fill: 'none', stroke: ink, 'stroke-opacity': light ? 0.45 : 0.35,
        }));
    }

    /* ---- the lattice ---- */
    if (dyadDots || dyadLabels) {
        const range = complexityRange();
        const span = range.hi - range.lo;
        const base = Math.max(1.2, 3.4 * o.baseSize);
        const stems = el('g');
        const dots = el('g');
        const names = el('g', { 'font-family': 'monospace', 'text-anchor': 'middle' });
        const placed = [];

        const heightOf = (d) => {
            const v = axis.ofDyad(d);
            return axis.lift(v === v ? Math.min(1, Math.max(0, v)) : 0.06);
        };

        const byComplexity = currentDyads().slice().sort((a, b) => a.complexity - b.complexity);
        for (const d of byComplexity) {
            if (d.c > C + 1e-6) continue;
            const [x] = fit.toPx(d.c / C, 0);
            const y = fit.y0 - heightOf(d) * (fit.y0 - fit.y1);
            const norm = span > 1e-12 ? (d.complexity - range.lo) / span : 0.5;
            let fill = ink;
            if (o.enableColor) {
                fill = rgbOf(colormapFn()(Math.min(1, Math.max(0, (1 - norm) * (o.scalingFactor / 2)))));
            }
            if (dyadDots) {
                const r = o.enableSize ? base * (1 + (1 - norm) * (o.scalingFactor - 1)) : base;
                stems.appendChild(el('line', {
                    x1: f(x), y1: f(yFloor), x2: f(x), y2: f(y),
                    stroke: fill, 'stroke-opacity': 0.5,
                }));
                dots.appendChild(el('circle', {
                    cx: f(x), cy: f(y), r: f(Math.max(0.6, r)), fill,
                }));
            }
            if (dyadLabels) {
                const size = labelSize(d.label) * o.baseSize;
                if (size < 4) continue;
                /* The same collision test the pane applies, so the file is a
                   picture of what was on screen rather than of everything the
                   set contains piled on top of itself. */
                const half = size * 0.32 * d.label.length + 2;
                const lx = Math.min(fit.x1 - half, Math.max(fit.x0 + half, x));
                const top = y - (dyadDots ? base + 2 : 0);
                if (placed.some((p) => Math.abs(p.x - lx) < p.half + half
                                    && Math.abs(p.y - top) < size + 2)) continue;
                placed.push({ x: lx, half, y: top });
                const t = el('text', { x: f(lx), y: f(top), 'font-size': f(size), fill });
                t.textContent = d.label;
                names.appendChild(t);
            }
        }
        svg.appendChild(stems);
        svg.appendChild(dots);
        svg.appendChild(names);
    }

    return new XMLSerializer().serializeToString(svg);
}

export function saveDyadSVG() {
    downloadSVG(exportDyadSVG(), 'dyads-export.svg');
}

/**
 * The picture, rasterised.
 *
 * Through the SVG above, so print size is a real choice rather than whatever
 * the pane happened to be when the button was pressed.
 */
export function saveDyadPNG(filename = 'dyads-export.png') {
    const pane = document.getElementById('dyad-pane');
    const width = (pane && pane.clientWidth) || 1100;
    const height = (pane && pane.clientHeight) || 640;
    const MAX_SIDE = 12000, MAX_AREA = 60e6;
    const scale = Math.max(1, Math.min(4, MAX_SIDE / width, MAX_SIDE / height,
                                       Math.sqrt(MAX_AREA / (width * height))));

    const url = URL.createObjectURL(new Blob([exportDyadSVG()], { type: 'image/svg+xml;charset=utf-8' }));
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
        console.error('PNG export could not rasterise the plot.');
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
 * The other modes' columns over two voices, and one more this mode can fill:
 * what the current model says about each interval, alongside the discrete
 * complexity the whole app is set to measure by. The two side by side are the
 * comparison the mode is for, in a form you can take somewhere else.
 */
export function exportDyadCSV() {
    const dyads = currentDyads();
    if (!dyads.length) { console.warn('No dyads to export.'); return; }

    const select = document.getElementById('complexityMethod');
    const measure = select.options[select.selectedIndex].text;
    const o = readPanel();
    const C = axisCents(o.equaveRatio, dyadSpan);
    const curve = currentCurve();
    const model = currentCurveModel();

    const rows = dyads.slice().sort((a, b) => a.complexity - b.complexity).map((d) => {
        const [i, j] = d.label.split(':').map(Number);
        const ratio = `${j}/${i}`;
        const notes = `${simplifyFraction(i, i)} ${simplifyFraction(j, i)}`;
        const value = curve ? valueAtCents(curve, d.c, C) : NaN;
        return [
            d.label, ratio, `"${notes}"`, d.c.toFixed(3), d.complexity,
            curve ? (value === value ? value.toFixed(5) : '') : null,
        ].filter((x) => x !== null).join(',');
    });

    const header = ['Dyad', 'Ratio', 'Notes', 'Cents', measure]
        .concat(curve ? [model === 'he' ? 'HarmonicEntropy(nats)'
            : model === 'sethares' ? 'Sethares' : 'TenneyContinuous'] : [])
        .join(',');

    downloadCSV([header, ...rows].join('\n'), 'dyads-export.csv');
}
