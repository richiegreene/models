/* =====================================================================
 *  DYADS — the plot
 * =====================================================================
 *
 * One pane and no second view, because there is nothing for a second view to
 * disagree about: a dyad has one degree of freedom, so the picture is a curve
 * and a curve says where AND how deep in the same mark. The triangle needs a
 * contour map and a lifted surface side by side precisely because it cannot.
 *
 * WHAT IS DRAWN, BOTTOM TO TOP.  The ground, the ruler, the curve — shaded
 * under and stroked over — then the JI lattice stemmed up to it, then the
 * measured listeners, then the cursor. Everything is placed from the two-line
 * mapping in dyad-geometry.js, so a curve index, a screen pixel and an
 * interval are the same point counted three ways and the exporter can emit the
 * whole picture as real vectors.
 *
 * TWO WAYS TO READ IT, AND THE PANEL DECIDES WHICH.  With Grid on it is a
 * plot: a ruler in cents, a marked vertical axis, a frame. With Grid off all
 * of that goes, the margins it was being kept for go with it, and what is left
 * is the measure drawn across the pane. The second is not a degraded first —
 * the shape of a concordance curve is legible without a single number on it,
 * and once you know what the axes are the furniture is only in the way.
 * ------------------------------------------------------------------ */

import {
    fitPlot, axisCents, centsTicks, valueAtCents, normalise,
} from './dyad-geometry.js';
import {
    dyadFill, dyadLine, dyadLineWidth, dyadRelief, dyadGrid,
    dyadDots, dyadLabels, dyadSnap, dyadSpan, cursor,
} from './dyad-state.js';
import { currentDyads, currentCurve, complexityRange, modelName } from './dyad-curve.js';
import { currentLayoutMode } from '../globals.js';
import { colormapAt, isLightGround, groundCss } from '../calculations/color-mapping.js';
import { halftoneOn, screenMarks, paintMarks, inkCss } from '../calculations/halftone.js';

/** The colour layout the whole app is currently set to. */
export function colormap() { return colormapAt(currentLayoutMode); }
/** Its ramp — what the fill, the marks and the curve are coloured by. */
export function colormapFn() { return colormap().ramp; }
/** Whether that layout's ground is light, which every other colour follows. */
export function onLight() { return isLightGround(colormap().ground); }
/** The ground itself — cream, blush and sage as readily as black or white. */
export function groundColor() { return colormap().ground; }

let canvas = null;
let ctx = null;
let fit = null;
let onGesture = null;

/* The panel settings the last paint was made with. The pointer handlers need
   the axis to turn a pixel into an interval, and an event carries no arguments
   — so the drawer leaves them here rather than every caller passing them
   twice. */
let opts = { equaveRatio: 2, baseSize: 1, scalingFactor: 2, enableSize: true, enableColor: true };

export function attach2D(el, gestureHandler) {
    canvas = el;
    ctx = canvas.getContext('2d');
    onGesture = gestureHandler;
    bindPointer();
    return { draw, resize, hitTest, geometry: () => fit };
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
    /* The left margin exists for the axis title and the tick labels and the
       bottom one for the ruler. With the grid off there is nothing in either,
       so the plot takes the room back rather than sitting inset inside empty
       borders — which is most of what makes the bare render look bare. */
    fit = dyadGrid ? fitPlot(w, h)
                   : fitPlot(w, h, { padL: 18, padR: 18, padT: 18, padB: 18 });
}

/* ---------------------------------------------------------------------
 *  The vertical axis
 *
 *  Worked out once per paint and handed to everything that draws, so the
 *  curve, the lattice stems and the cursor cannot come to disagree about what
 *  a height means.
 *
 *  WHAT IS BEING MEASURED. Either one of the three continuous models, which
 *  has a value at every point of the axis and is therefore drawn as a curve;
 *  or the Complexity drawer's own measure, which has a value only AT the
 *  ratios and is therefore drawn as the height of the lattice and nothing
 *  else. Both are real answers to "how complex is this interval", and putting
 *  them on the same axis under the same switch is the point of the mode.
 *
 *  VALUE AND HEIGHT ARE NOT THE SAME NUMBER. `at` and `ofDyad` give the
 *  measure normalised across its own range, which is what the COLOUR is taken
 *  from; `lift` turns that into a height in the box, which is what the
 *  GEOMETRY is placed by. Relief is the difference between them, and keeping
 *  them apart is what lets a settled curve stay coloured by the values it
 *  actually has rather than by how much of the page it was given.
 * ------------------------------------------------------------------ */

/**
 * @returns {{curved: boolean, at: (c:number)=>number, ofDyad: (d:object)=>number,
 *            lift: (v:number)=>number, floor: number, title: string,
 *            ticks: Array<[number,string]>}}
 */
export function verticalAxis(o) {
    const curve = currentCurve();
    const curved = !!curve;
    const C = axisCents(o.equaveRatio, dyadSpan);

    const range = complexityRange();
    const norm = (x) => {
        const span = range.hi - range.lo;
        return span > 1e-12 ? (x - range.lo) / span : 0.5;
    };

    /* Scaled about the middle of the box rather than about its floor, so that
       turning Relief down settles the picture toward a straight line across
       the centre instead of crushing it into the bottom edge. */
    const lift = (v) => 0.5 + (v - 0.5) * dyadRelief;

    return {
        curved,
        at: (c) => (curved ? normalise(curve, valueAtCents(curve, c, C)) : NaN),
        /* A discrete measure counts UPWARD with complexity, so it is inverted
           here to keep "concordant is high" true of every axis this plot can
           be set to — the three continuous models already return it that way
           round. The 0.06 keeps the very simplest mark off the floor line. */
        ofDyad: (d) => (curved
            ? normalise(curve, valueAtCents(curve, d.c, C))
            : 0.06 + 0.9 * (1 - norm(d.complexity))),
        lift,
        /* Where the measure's zero sits once Relief has had its way. The
           stems stand on this and the fill closes to it, so the whole picture
           shrinks together rather than the curve alone. */
        floor: lift(0),
        title: curved ? modelName() : `${o.complexityMethod} norm`,
        /* The units are the measure's own and mean nothing next to another
           measure's, so the axis is marked as a DIRECTION rather than as a
           quantity — and a word is too wide for the margin a number fits in,
           so these are set inside the box. */
        ticks: curved ? [[0, 'discordant'], [1, 'concordant']]
                      : [[0, 'complex'], [1, 'simple']],
    };
}

/* ---------------------------------------------------------------------
 *  Drawing
 * ------------------------------------------------------------------ */

const rgbOf = (c) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;

/**
 * The colormap laid along the axis, as a paint.
 *
 * The measure's value is a function of the horizontal position and of nothing
 * else, so "colour this by the value" and "colour this with a horizontal
 * gradient" are the same instruction — which is what lets a stroke be coloured
 * by the value at all. A thick line then runs through the ramp along its
 * length instead of being one flat sample of it. On a constant layout every
 * stop is the same colour and it comes out flat, which is what constant means.
 *
 * A gradient rather than a segment per column: a stroke has to be drawn as one
 * path or its joins and its round caps are not the shape they should be, and
 * hundreds of short separately-coloured segments would overlap at every bend
 * and show every one of them at any real line width.
 */
function valueGradient(x0, x1, cols, vs, map) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    const stops = Math.max(2, Math.min(cols - 1, 512));
    for (let s = 0; s <= stops; s++) {
        const i = Math.round((s / stops) * (cols - 1));
        const v = vs[i];
        g.addColorStop(s / stops, rgbOf(map(v === v ? Math.min(1, Math.max(0, v)) : 0)));
    }
    return g;
}

/**
 * @param {object} o the settings the drawer reads out of the panel:
 *        equaveRatio, enableSize, enableColor, baseSize, scalingFactor
 */
export function draw(o) {
    if (!ctx || !fit) return;
    opts = o;
    const w = canvas.clientWidth, h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    /* The layout's own ground, not a black-or-white guess: the bright layouts
       sit on tinted paper, and a pane painted hard white behind them would
       show the tint as a rectangle floating on a lamp. */
    ctx.fillStyle = groundCss(groundColor());
    ctx.fillRect(0, 0, w, h);

    const C = axisCents(o.equaveRatio, dyadSpan);
    const axis = verticalAxis(o);

    if (dyadGrid) drawFrame(o, C, axis);
    drawCurve(o, C, axis);
    drawLattice(o, C, axis);
    drawCursor(o, C, axis);
}

const ink = (a) => (onLight() ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);

/** Whether the two ends of the axis are far enough apart to be read as two. */
export function marksAreLegible(axis, fitted = fit) {
    if (!fitted) return false;
    const [, top] = fitted.toPx(0, axis.lift(1));
    const [, bottom] = fitted.toPx(0, axis.lift(0));
    return Math.abs(bottom - top) >= 34;
}

/** The box, the cents ruler along the bottom, and whatever the y axis is. */
function drawFrame(o, C, axis) {
    const { x0, x1, y0, y1 } = fit;
    const { step, ticks } = centsTicks(C);

    ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

    /* Verticals every tick, labelled every third — a ruler you can count
       along without one that shouts over the curve. */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ticks.forEach((c, i) => {
        const [x] = fit.toPx(c / C, 0);
        const major = i % 3 === 0;
        ctx.strokeStyle = ink(major ? 0.16 : 0.08);
        ctx.beginPath();
        ctx.moveTo(x, y0); ctx.lineTo(x, y1);
        ctx.stroke();
        if (major || step >= 200) {
            ctx.fillStyle = ink(0.55);
            ctx.fillText(String(Math.round(c)), x, y0 + 7);
        }
    });

    ctx.fillStyle = ink(0.45);
    ctx.fillText('cents', (x0 + x1) / 2, y0 + 24);

    /* Marked where the measure's ends actually ARE, which Relief moves. A
       "concordant" pinned to the top of the box while the curve had settled
       into the middle would be labelling the frame rather than the data.
       Which means that at low relief the two ends converge, and below the
       height of the words themselves they stop being two marks and become one
       illegible one — so they are dropped rather than overprinted. The axis
       title up the left edge still says what the height is. */
    if (marksAreLegible(axis)) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const [v, label] of axis.ticks) {
            const [, y] = fit.toPx(0, axis.lift(v));
            if (y < y1 - 1 || y > y0 + 1) continue;
            ctx.fillStyle = ink(0.55);
            /* Nudged off whichever edge it is nearest, so a word set inside
               the box at the very top or the bottom is not half over the
               frame. */
            ctx.fillText(label, x0 + 6, y + (v > 0.5 ? 9 : -9));
        }
    }

    ctx.strokeStyle = ink(onLight() ? 0.45 : 0.35);
    ctx.strokeRect(x0, y1, x1 - x0, y0 - y1);

    /* The axis title runs up the left edge, which is where a reader looks for
       what the height means and is the only place it fits without crowding
       the plot. */
    ctx.save();
    ctx.translate(14, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink(0.5);
    ctx.fillText(axis.title, 0, 0);
    ctx.restore();
}

/**
 * The measure itself.
 *
 * Shaded under and stroked over, independently, and BOTH coloured by the
 * measure's own value at that point — so the ramp says the same thing the
 * height says and the two readings reinforce each other, which is what makes
 * a colour layout mean anything on a curve at all.
 *
 * The shading walks the columns and the stroke takes a gradient, which is the
 * same colouring arrived at two ways: a fill can be laid down a column at a
 * time and be exact, but a stroke has to be one path or its joins and caps
 * come apart, so it needs the ramp as a paint rather than as a loop.
 */
function drawCurve(o, C, axis) {
    const curve = currentCurve();
    if (!curve) return;
    const { x0, x1, y0, y1 } = fit;
    const map = colormapFn();
    const yFloor = y0 - axis.floor * (y0 - y1);

    /* One sample per pixel column. The model is computed at 1600 samples and
       the pane is rarely wider than that, so this is the finer of the two
       grids either way and there is nothing to gain by walking the coarser. */
    const cols = Math.max(2, Math.round(x1 - x0));
    const ys = new Float64Array(cols);
    const vs = new Float64Array(cols);
    for (let i = 0; i < cols; i++) {
        const t = i / (cols - 1);
        /* The VALUE, kept as it is — the colour is a statement about the
           measure and must not change because the picture was made smaller. */
        vs[i] = axis.at(t * C);
        /* The HEIGHT, which is the value after Relief has had its way. */
        const h = axis.lift(Math.min(1, Math.max(0, vs[i] === vs[i] ? vs[i] : 0)));
        ys[i] = y0 - h * (y0 - y1);
    }

    const path = new Path2D();
    path.moveTo(x0, ys[0]);
    for (let i = 1; i < cols; i++) path.lineTo(x0 + i, ys[i]);

    if (dyadFill) {
        /* Closed to the lifted floor rather than to the bottom of the box, so
           a settled curve is a thin band about the centre rather than a full
           height of colour with a flat top. */
        const area = new Path2D(path);
        area.lineTo(x1, yFloor);
        area.lineTo(x0, yFloor);
        area.closePath();
        ctx.save();
        ctx.clip(area);
        if (halftoneOn()) {
            /* The screen under the curve, each cell inked by the value at its
               column — the same reading the ramp would have given it. */
            paintMarks(ctx, screenMarks(x0, y1, x1, y0, (px) => {
                const i = Math.round(px - x0);
                if (i < 0 || i >= cols) return NaN;
                return vs[i];
            }));
        } else {
            /* Column by column through the ramp. A gradient object would be
               tidier and would also be a lie: the ramp is not linear in the
               value, so its stops would have to be sampled anyway. */
            for (let i = 0; i < cols; i++) {
                const v = Math.min(1, Math.max(0, vs[i]));
                const c = map(v === v ? v : 0);
                ctx.fillStyle = rgbOf(c);
                ctx.fillRect(x0 + i, y1, 1.02, y0 - y1);
            }
        }
        ctx.restore();
    }

    if (dyadLine) {
        /* Through the colormap, whether or not there is a fill under it. The
           line used to be a flat sample of the ramp, which wasted the one
           thing a thick line can show that a thin one cannot: at eight pixels
           it is wide enough to read as a coloured band, and the band should
           say what the height says. Over a fill the two agree by construction,
           so the stroke reads as the fill's own edge rather than as an outline
           drawn around it. */
        ctx.strokeStyle = halftoneOn() ? inkCss() : valueGradient(x0, x1, cols, vs, map);
        ctx.lineWidth = dyadLineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(path);
    }
}

/** Isoharmonics' rule: a longer label is drawn smaller, so it stays legible. */
function labelSize(label) {
    const digits = Math.max(3, (label.match(/\d/g) || []).length);
    return Math.max(4.5, 11 * Math.pow(0.79370046571, digits - 3));
}

function dyadColor(d, range, enableColor, scaling) {
    if (halftoneOn()) return inkCss();
    if (!enableColor) return onLight() ? '#111' : '#fff';
    const span = range.hi - range.lo;
    const norm = span > 1e-12 ? (d.complexity - range.lo) / span : 0.5;
    const v = Math.min(1, Math.max(0, (1 - norm) * (scaling / 2)));
    return rgbOf(colormapFn()(v));
}

/**
 * The just intervals, stemmed up to the curve.
 *
 * A stem rather than a bare dot because the mark has to say two things at
 * once: WHERE the interval is, which is a position along the ruler, and WHAT
 * THE MODEL SAYS ABOUT IT, which is a height. A dot floating at the height
 * would leave the reader measuring back down to the axis by eye.
 *
 * Labels are placed simplest-first and any that would collide with one already
 * placed is dropped. A 13-limit over two equaves is a hundred intervals, and
 * without this the important names are the ones buried: 3/2 would be overdrawn
 * by 27/16 for no better reason than that it came later in the list.
 */
function drawLattice(o, C, axis) {
    if (!dyadDots && !dyadLabels) return;
    const dyads = currentDyads();
    if (!dyads.length) return;

    const { y0, y1 } = fit;
    const range = complexityRange();
    const span = range.hi - range.lo;
    const base = Math.max(1.2, 3.4 * o.baseSize);

    /* The axis knows how tall a mark is under every setting — read off a
       curve, or taken from the mark's own complexity when the measure is one
       of the discrete six. A mark whose height cannot be worked out at all
       stands on the floor rather than vanishing. Lifted, like everything else
       vertical, so the lattice settles with the curve it is stemmed to. */
    const heightOf = (d) => {
        const v = axis.ofDyad(d);
        return axis.lift(v === v ? Math.min(1, Math.max(0, v)) : 0.06);
    };
    const yFloor = y0 - axis.floor * (y0 - y1);

    const placed = [];
    const simplestFirst = dyads.slice().sort((a, b) => a.complexity - b.complexity);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    /* Two passes: the stems and dots in the set's own order, so the simplest
       are painted last and land on top; then the labels simplest-first, so the
       simplest are the ones that survive the collision test. */
    for (const d of dyads) {
        if (d.c > C + 1e-6) continue;
        const [x] = fit.toPx(d.c / C, 0);
        const y = y0 - heightOf(d) * (y0 - y1);
        const color = dyadColor(d, range, o.enableColor, o.scalingFactor);

        if (dyadDots) {
            let r = base;
            if (o.enableSize) {
                const norm = span > 1e-12 ? (d.complexity - range.lo) / span : 0.5;
                r = base * (1 + (1 - norm) * (o.scalingFactor - 1));
            }
            ctx.strokeStyle = color;
            /* A stem at half strength is a grey, and a screened page has none. */
            ctx.globalAlpha = halftoneOn() ? 1 : 0.5;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yFloor); ctx.lineTo(x, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (!dyadLabels) return;
    for (const d of simplestFirst) {
        if (d.c > C + 1e-6) continue;
        const size = labelSize(d.label) * o.baseSize;
        if (size < 4) continue;
        const [x] = fit.toPx(d.c / C, 0);
        const y = y0 - heightOf(d) * (y0 - y1);

        ctx.font = `${size.toFixed(1)}px monospace`;
        const half = ctx.measureText(d.label).width / 2 + 2;
        /* The unison sits on the left edge and the equave on the right, so
           their names would hang half outside the frame if they were simply
           centred on the mark. Nudged in, which is the one place a label is
           allowed not to be centred on what it names. */
        const lx = Math.min(fit.x1 - half, Math.max(fit.x0 + half, x));
        const top = y - (dyadDots ? base + 2 : 0);
        if (placed.some((p) => Math.abs(p.x - lx) < p.half + half
                            && Math.abs(p.y - top) < size + 2)) continue;
        placed.push({ x: lx, half, y: top });

        ctx.fillStyle = dyadColor(d, range, o.enableColor, o.scalingFactor);
        ctx.fillText(d.label, lx, top);
    }
}

/**
 * Where the pointer is, and what is there.
 *
 * With the grid up this is a plot's cursor: a crosshair down the whole box so
 * the position can be read off the ruler, a ring where it meets the curve, and
 * a readout of the number the mode is about — what this measure says about
 * THIS interval, which has nowhere else to appear.
 *
 * With the grid down it is a dot on a line, and nothing else. There is no
 * ruler left to drop a crosshair onto and no furniture for a readout to sit
 * among, so both would be the only chrome on an otherwise bare page — which is
 * exactly what turning the grid off was asking to be rid of.
 */
function drawCursor(o, C, axis) {
    if (!cursor.live) return;
    const { y0, y1, x1 } = fit;
    const [x] = fit.toPx(Math.min(1, Math.max(0, cursor.c / C)), 0);
    const line = onLight() ? '#111' : '#fff';
    const v = axis.at(cursor.c);
    const y = v === v ? y0 - axis.lift(Math.min(1, Math.max(0, v))) * (y0 - y1) : NaN;

    if (!dyadGrid) {
        /* Filled rather than ringed: at a hair's width there is no room for a
           hole in the middle, and a solid dot is what reads as a position on
           a line at any line width. */
        if (y === y) {
            ctx.fillStyle = line;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(3, dyadLineWidth * 1.6), 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    ctx.strokeStyle = line;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.stroke();

    if (y === y) {
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.stroke();
    }

    const curve = currentCurve();
    const raw = curve ? valueAtCents(curve, cursor.c, C) : NaN;
    const parts = [`${Math.round(cursor.c)}¢`];
    /* The model's own number, in its own unit — nats, for an entropy. */
    if (raw === raw) parts.push(raw.toFixed(3) + (curve.unit ? ` ${curve.unit}` : ''));

    const text = parts.join('  ·  ');
    ctx.font = '11px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
    const wide = ctx.measureText(text).width;
    /* Flipped to the other side near the right edge, so the readout never
       runs off the pane the drag has just reached the end of. */
    const left = x + 8 + wide + 8 > x1 ? x - 8 - wide - 8 : x + 8;

    ctx.fillStyle = onLight() ? 'rgba(255,255,255,.86)' : 'rgba(0,0,0,.72)';
    ctx.fillRect(left, y1 + 6, wide + 8, 18);
    ctx.strokeStyle = ink(0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(left, y1 + 6, wide + 8, 18);
    ctx.fillStyle = line;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 4, y1 + 15);
}

/* ---------------------------------------------------------------------
 *  The gesture
 *
 *  Pointer events with capture, exactly as the triangle takes them: a drag
 *  that leaves the pane keeps sounding and keeps being followed, so running
 *  off the edge slides along it instead of cutting the note off.
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

function locate(ev) {
    const r = canvas.getBoundingClientRect();
    return hitTest(ev.clientX - r.left, ev.clientY - r.top);
}

/**
 * A point in this pane's pixels, as an interval.
 *
 * Only the horizontal is read: the height is the model's answer, not an input,
 * so a drag anywhere in the box is a drag along the axis. That is deliberate —
 * it means the whole pane is playable rather than only the hairline of the
 * curve itself.
 *
 * Snapping is done in PIXELS rather than in cents, so it means the same thing
 * at every axis width: the question a hand is asking is "am I near that mark",
 * and a mark is a fixed size on screen.
 */
export function hitTest(px, py, o = opts) {
    if (!fit) return null;
    const C = axisCents(o?.equaveRatio ?? 2, dyadSpan);
    const [t] = fit.toUnit(px, py);
    const c = Math.min(C, Math.max(0, t * C));

    if (dyadSnap > 0 && (dyadDots || dyadLabels)) {
        const snapped = nearestDyad(px, C);
        if (snapped) return { c: snapped.c, label: snapped.label, snapped: true };
    }
    return { c, label: null, snapped: false };
}

function nearestDyad(px, C) {
    let best = null, bestD = dyadSnap;
    for (const d of currentDyads()) {
        if (d.c > C + 1e-6) continue;
        const [x] = fit.toPx(d.c / C, 0);
        const dist = Math.abs(x - px);
        if (dist <= bestD) { bestD = dist; best = d; }
    }
    return best;
}
