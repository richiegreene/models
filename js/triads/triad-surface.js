/* =====================================================================
 *  TRIADS — asking Python for the set and the field
 * =====================================================================
 *
 * Two very different costs behind one module, which is why they are cached
 * separately:
 *
 *   the TRIAD SET   milliseconds. Every JI triad under the current limit,
 *                   which the dots, the labels, the snapping and the CSV all
 *                   read. Regenerated whenever a limit setting moves.
 *
 *   the FIELD       up to a couple of seconds, on the page's own thread,
 *                   because Pyodide has nowhere else to run. So it is never
 *                   regenerated as a side effect of anything: Generate is a
 *                   press, and the result is held until a parameter that
 *                   actually changes the model is moved.
 *
 * The cache key is the whole of the request. A model that would come out
 * identical is not computed twice, and one that would not is never served
 * stale — which matters most for the equave, since it is shared with Tetrads
 * and can be changed from a drawer that says nothing about surfaces.
 * ------------------------------------------------------------------ */

import { pyodide, python_ready } from '../globals.js';
import { wrapField } from './triad-geometry.js';
import { spectrumFor } from '../synth/timbre.js';
import { heParams, smParams } from './triad-state.js';

/** The generated set, and what it was generated from. */
let triadSet = [];
let setKey = null;

/** The field, and what it was generated from. */
let field = null;
let fieldKey = null;
let fieldModel = 'blank';
/** The equave the field was computed for — see fieldIsStale below. */
let fieldEquave = null;

export function currentTriads() { return triadSet; }
export function currentField() { return field; }
export function currentFieldModel() { return fieldModel; }

/** Throw the field away — what a model change or a failed generate leaves. */
export function clearField() {
    field = null;
    fieldKey = null;
    fieldModel = 'blank';
    fieldEquave = null;
}

/**
 * Whether the field on screen is a picture of a different triangle.
 *
 * The equave is shared with Tetrads and can be changed from a drawer that
 * says nothing about surfaces — and it does not merely rescale the triangle,
 * it changes which chords are in it. A field computed for an octave drawn
 * over a tritave would put every peak in the wrong place while looking
 * perfectly plausible, which is the worst kind of wrong a diagram can be. So
 * a stale field is thrown away rather than redrawn.
 */
export function fieldIsStale(equaveRatio) {
    return !!field && fieldEquave !== null
        && Math.abs(fieldEquave - equaveRatio) > 1e-9;
}

/**
 * Every JI triad under these settings, as
 * `{ c1, c2, label, complexity }`, plus the range of complexity across them.
 *
 * Same arguments the tetrahedron is built from and in the same order, so the
 * two modes cannot come to read the Complexity drawer differently.
 */
export async function generateTriadSet(opts) {
    if (!python_ready) return triadSet;

    const key = JSON.stringify(opts);
    if (key === setKey) return triadSet;

    const vf = opts.virtualFundamentalFilter
        ? JSON.stringify(opts.virtualFundamentalFilter) : 'None';
    const limit = typeof opts.limitValue === 'string' && opts.limitValue.includes('.')
        ? `"${opts.limitValue}"` : opts.limitValue;

    pyodide.globals.set('py_tri_hide_unisons', !!opts.hideUnisonVoices);
    pyodide.globals.set('py_tri_omit_octaves', !!opts.omitOctaves);

    const raw = await pyodide.runPythonAsync(`
from triads_generator import generate_triads
generate_triads(
    limit_value=${limit},
    equave_ratio=${opts.equaveRatio},
    limit_mode="${String(opts.limitType).toLowerCase()}",
    max_exponent=${opts.maxExponent},
    complexity_measure="${opts.complexityMethod}",
    hide_unison_voices=py_tri_hide_unisons,
    omit_octaves=py_tri_omit_octaves,
    virtual_fundamental_filter=${vf}
)
    `);

    const out = [];
    for (const row of raw) {
        out.push({ c1: row[0], c2: row[1], label: row[2], complexity: row[3] });
    }
    /* Simplest last, so the simplest chords are drawn on top of the thicket
       of complex ones rather than under it. */
    out.sort((a, b) => b.complexity - a.complexity);

    triadSet = out;
    setKey = key;
    return triadSet;
}

/** The complexity range across the current set, for sizing and colouring. */
export function complexityRange() {
    let lo = Infinity, hi = -Infinity;
    for (const t of triadSet) { lo = Math.min(lo, t.complexity); hi = Math.max(hi, t.complexity); }
    return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 1 };
}

/**
 * Build the field for one model, or return the one already built for it.
 *
 * @returns {Promise<{ok: boolean, cached?: boolean, ms?: number, error?: string}>}
 */
export async function generateField(model, { equaveRatio, timbre }) {
    if (!python_ready) return { ok: false, error: 'Python is still loading' };

    if (model === 'blank') {
        clearField();
        return { ok: true, cached: true };
    }

    const key = model === 'he'
        ? JSON.stringify(['he', equaveRatio, heParams])
        : JSON.stringify(['sm', equaveRatio, smParams, timbre]);

    if (key === fieldKey && field) {
        fieldModel = model;
        fieldEquave = equaveRatio;
        return { ok: true, cached: true };
    }

    const t0 = performance.now();
    let packed;
    try {
        if (model === 'he') {
            packed = await pyodide.runPythonAsync(`
from triads_generator import harmonic_entropy_grid
harmonic_entropy_grid(
    equave_ratio=${equaveRatio},
    width=${Math.round(heParams.resolution)},
    root=${Math.round(heParams.root)},
    series="${heParams.series === 'weil' ? 'weil' : 'tenney'}",
    alpha=${Number(heParams.alpha)},
    spread_cents=${Number(heParams.spread)},
    beta=${heParams.kernel === 'laplace' ? 1 : 2}
)
            `);
        } else {
            const spec = spectrumFor(timbre, smParams.partials);
            pyodide.globals.set('py_sm_freq', spec.freq);
            pyodide.globals.set('py_sm_amp', spec.amp);
            packed = await pyodide.runPythonAsync(`
from triads_generator import sethares_grid
sethares_grid(
    spectrum_freq=py_sm_freq,
    spectrum_amp=py_sm_amp,
    ref_freq=261.6256,
    equave_ratio=${equaveRatio},
    step_size=${smParams.step},
    width=${Math.round(smParams.resolution)},
    z_ramp=${smParams.ramp},
    spread_cents=${smParams.spread}
)
            `);
        }
    } catch (err) {
        clearField();
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }

    if (!packed) {
        clearField();
        return { ok: false, error: 'the model produced nothing at these settings' };
    }

    /* toJs rather than property access: the object comes back as a PyProxy,
       and the buffer inside it has to be copied out before the proxy is
       destroyed or the Float32Array is left pointing at freed WASM memory. */
    const obj = packed.toJs ? packed.toJs({ create_proxies: false }) : packed;
    const plain = obj instanceof Map
        ? { w: obj.get('w'), h: obj.get('h'), min: obj.get('min'), max: obj.get('max'),
            up: obj.get('up'), unit: obj.get('unit'), count: obj.get('count'), data: obj.get('data') }
        : obj;
    field = wrapField({ ...plain, data: Uint8Array.from(plain.data) });
    if (packed.destroy) packed.destroy();

    fieldKey = key;
    fieldModel = model;
    fieldEquave = equaveRatio;
    return { ok: true, ms: performance.now() - t0 };
}
