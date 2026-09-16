/* =====================================================================
 *  DYADS — asking Python for the set and the curve
 * =====================================================================
 *
 * Two costs behind one module, cached separately, exactly as the triangle's
 * surface is:
 *
 *   the DYAD SET   milliseconds. Every JI dyad under the current limit, which
 *                  the marks, the labels, the snapping and the CSV all read.
 *                  Regenerated whenever a limit setting moves.
 *
 *   the CURVE      tens of milliseconds — which is the one real difference
 *                  from the triangle. A surface is a grid and a curve is a
 *                  line, so what costs a second and a half over there costs
 *                  almost nothing here, and this mode can afford to recompute
 *                  on the settle timer without ever making the panel wait.
 *
 * It is still cached, and on the whole of the request, for the reason the
 * surface is: a model that would come out identical is not computed twice, and
 * one that would not is never served stale. The equave matters most, since it
 * is shared with the other two modes and can be changed from a drawer that
 * says nothing about curves.
 * ------------------------------------------------------------------ */

import { pyodide, python_ready } from '../globals.js';
import { wrapCurve } from './dyad-geometry.js';
import { spectrumFor } from '../synth/timbre.js';
import { dheParams, dsmParams, dtnParams } from './dyad-state.js';

/** The generated set, and what it was generated from. */
let dyadSet = [];
let setKey = null;

/** The curve, and what it was generated from. */
let curve = null;
let curveKey = null;
let curveModel = 'discrete';
/** The axis the curve was computed for — see curveIsStale below. */
let curveAxis = null;

export function currentDyads() { return dyadSet; }
export function currentCurve() { return curve; }
export function currentCurveModel() { return curveModel; }

/** Throw the curve away — what a model change or a failed generate leaves. */
export function clearCurve() {
    curve = null;
    curveKey = null;
    curveModel = 'discrete';
    curveAxis = null;
}

/**
 * Whether the curve on screen is a picture of a different axis.
 *
 * The equave is shared and the span is not, but either one changes how many
 * cents the plot is wide — and that does not merely rescale the picture, it
 * changes which intervals are in it and where every peak lands. A curve
 * computed for one octave drawn across two would put 3/2 at a fifth of the way
 * along while looking perfectly plausible, which is the worst kind of wrong a
 * diagram can be. So a stale curve is thrown away rather than redrawn.
 */
export function curveIsStale(axisRatio) {
    return !!curve && curveAxis !== null && Math.abs(curveAxis - axisRatio) > 1e-9;
}

/**
 * Every JI dyad under these settings, as `{ c, label, complexity }`.
 *
 * The same arguments the other two modes are built from and in the same order,
 * so the three cannot come to read the Complexity drawer differently — with
 * the axis in place of the equave, because a dyad is allowed past it.
 */
export async function generateDyadSet(opts) {
    if (!python_ready) return dyadSet;

    const key = JSON.stringify(opts);
    if (key === setKey) return dyadSet;

    const vf = opts.virtualFundamentalFilter
        ? JSON.stringify(opts.virtualFundamentalFilter) : 'None';
    const limit = typeof opts.limitValue === 'string' && opts.limitValue.includes('.')
        ? `"${opts.limitValue}"` : opts.limitValue;

    pyodide.globals.set('py_dy_hide_unisons', !!opts.hideUnisonVoices);
    pyodide.globals.set('py_dy_omit_octaves', !!opts.omitOctaves);

    const raw = await pyodide.runPythonAsync(`
from dyads_generator import generate_dyads
generate_dyads(
    limit_value=${limit},
    axis_ratio=${opts.axisRatio},
    limit_mode="${String(opts.limitType).toLowerCase()}",
    max_exponent=${opts.maxExponent},
    complexity_measure="${opts.complexityMethod}",
    hide_unison_voices=py_dy_hide_unisons,
    omit_octaves=py_dy_omit_octaves,
    virtual_fundamental_filter=${vf}
)
    `);

    const out = [];
    for (const row of raw) {
        out.push({ c: row[0], label: row[1], complexity: row[2] });
    }
    /* Simplest last, so the simplest intervals are drawn on top of the thicket
       of complex ones rather than under it. */
    out.sort((a, b) => b.complexity - a.complexity);

    dyadSet = out;
    setKey = key;
    return dyadSet;
}

/** The complexity range across the current set, for sizing and colouring. */
export function complexityRange() {
    let lo = Infinity, hi = -Infinity;
    for (const d of dyadSet) { lo = Math.min(lo, d.complexity); hi = Math.max(hi, d.complexity); }
    return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 1 };
}

/**
 * Build the curve for one model, or return the one already built for it.
 *
 * @returns {Promise<{ok: boolean, cached?: boolean, ms?: number, error?: string}>}
 */
export async function generateCurve(model, { axisRatio, timbre }) {
    if (!python_ready) return { ok: false, error: 'Python is still loading' };

    /* The discrete measures are not a curve and are not computed here at
       all: they come back on every dyad of the set, from the same generator
       call the lattice is built by. So asking for one is asking for no
       curve. */
    if (model === 'discrete') {
        clearCurve();
        return { ok: true, cached: true };
    }

    const key = model === 'he' ? JSON.stringify(['he', axisRatio, dheParams])
        : model === 'sethares' ? JSON.stringify(['sm', axisRatio, dsmParams, timbre])
        : JSON.stringify(['tn', axisRatio, dtnParams]);

    if (key === curveKey && curve) {
        curveModel = model;
        curveAxis = axisRatio;
        return { ok: true, cached: true };
    }

    const t0 = performance.now();
    let packed;
    try {
        if (model === 'he') {
            packed = await pyodide.runPythonAsync(`
from dyads_generator import harmonic_entropy_curve
harmonic_entropy_curve(
    axis_ratio=${axisRatio},
    width=${Math.round(dheParams.resolution)},
    root=${Math.round(dheParams.root)},
    series="${dheParams.series === 'weil' ? 'weil' : 'tenney'}",
    alpha=${Number(dheParams.alpha)},
    spread_cents=${Number(dheParams.spread)},
    beta=${dheParams.kernel === 'laplace' ? 1 : 2}
)
            `);
        } else if (model === 'sethares') {
            const spec = spectrumFor(timbre, dsmParams.partials);
            pyodide.globals.set('py_dsm_freq', spec.freq);
            pyodide.globals.set('py_dsm_amp', spec.amp);
            packed = await pyodide.runPythonAsync(`
from dyads_generator import sethares_curve
sethares_curve(
    spectrum_freq=py_dsm_freq,
    spectrum_amp=py_dsm_amp,
    ref_freq=261.6256,
    axis_ratio=${axisRatio},
    width=${Math.round(dsmParams.resolution)},
    z_ramp=${dsmParams.ramp}
)
            `);
        } else {
            packed = await pyodide.runPythonAsync(`
from dyads_generator import tenney_curve
tenney_curve(
    axis_ratio=${axisRatio},
    width=${Math.round(dtnParams.resolution)},
    depth=${Math.round(dtnParams.depth)},
    softness=${dtnParams.softness}
)
            `);
        }
    } catch (err) {
        clearCurve();
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }

    if (!packed) {
        clearCurve();
        return { ok: false, error: 'the model produced nothing at these settings' };
    }

    /* toJs rather than property access: the object comes back as a PyProxy and
       the buffer inside it has to be copied out before the proxy is destroyed,
       or the Float32Array is left pointing at freed WASM memory. */
    const obj = packed.toJs ? packed.toJs({ create_proxies: false }) : packed;
    const plain = obj instanceof Map
        ? { n: obj.get('n'), min: obj.get('min'), max: obj.get('max'),
            up: obj.get('up'), unit: obj.get('unit'), count: obj.get('count'), data: obj.get('data') }
        : obj;
    curve = wrapCurve({ ...plain, data: Uint8Array.from(plain.data) });
    if (packed.destroy) packed.destroy();

    curveKey = key;
    curveModel = model;
    curveAxis = axisRatio;
    return { ok: true, ms: performance.now() - t0 };
}

/**
 * What the current model is called.
 *
 * Two lengths, because there are two places with very different room. The axis
 * title runs the height of the pane and can say what the measure actually is;
 * the foot is one line in a 340-pixel panel and already has a count and a fit
 * to carry, and a name that pushed those off the end would lose the two things
 * worth reading.
 */
export function modelName(model = curveModel) {
    return model === 'he' ? 'harmonic entropy'
        : model === 'sethares' ? 'sensory dissonance'
        : model === 'tenney' ? 'Tenney (continuous)'
        : null;
}

export function modelShortName(model = curveModel) {
    return model === 'he' ? 'entropy'
        : model === 'sethares' ? 'sethares'
        : model === 'tenney' ? 'Tenney'
        : null;
}
