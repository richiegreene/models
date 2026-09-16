/* =====================================================================
 *  TETRADS — asking Python for the field
 * =====================================================================
 *
 * The triangle's triad-surface.js, for the volume: one cost, cached on the
 * whole of the request, so a field that would come out identical is not
 * computed twice and one that would not is never served stale.
 *
 * The set of tetrads is not here. It comes from tetrahedron_generator.py,
 * exactly as it always has — see updateTetrahedron — and the field does not
 * depend on it at all: the entropy is taken against EVERY tetrad under the
 * height bound, not the ones the limit happens to admit, which is what makes
 * it a model of the ear rather than a picture of the lattice.
 * ------------------------------------------------------------------ */

import { pyodide, python_ready } from '../globals.js';
import { wrapVolume } from './tetrad-geometry.js';
import { theParams } from './tetrad-state.js';

/** The field, and what it was generated from. */
let volume = null;
let volumeKey = null;
let volumeEquave = null;

export function currentVolume() { return volume; }

/** Throw the field away — what a model change or a failed generate leaves. */
export function clearVolume() {
    volume = null;
    volumeKey = null;
    volumeEquave = null;
}

/**
 * Whether the field on screen is a picture of a different tetrahedron.
 *
 * The equave does not rescale the shape, it changes which chords are in it;
 * a field computed for an octave drawn over a tritave would put every well
 * in the wrong place while looking perfectly plausible.
 */
export function volumeIsStale(equaveRatio) {
    return !!volume && volumeEquave !== null && Math.abs(volumeEquave - equaveRatio) > 1e-9;
}

/**
 * Build the field, or return the one already built for these settings.
 *
 * @returns {Promise<{ok: boolean, cached?: boolean, ms?: number, error?: string}>}
 */
export async function generateVolume({ equaveRatio }) {
    if (!python_ready) return { ok: false, error: 'Python is still loading' };

    const key = JSON.stringify(['he', equaveRatio, theParams]);
    if (key === volumeKey && volume) {
        volumeEquave = equaveRatio;
        return { ok: true, cached: true };
    }

    const t0 = performance.now();
    let packed;
    try {
        packed = await pyodide.runPythonAsync(`
from tetrads_entropy import harmonic_entropy_volume
harmonic_entropy_volume(
    equave_ratio=${equaveRatio},
    res=${Math.round(theParams.resolution)},
    root=${Math.round(theParams.root)},
    series="${theParams.series === 'weil' ? 'weil' : 'tenney'}",
    alpha=${Number(theParams.alpha)},
    spread_cents=${Number(theParams.spread)},
    beta=${theParams.kernel === 'laplace' ? 1 : 2}
)
        `);
    } catch (err) {
        clearVolume();
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }

    if (!packed) {
        clearVolume();
        return { ok: false, error: 'the model produced nothing at these settings' };
    }

    /* toJs rather than property access: the object comes back as a PyProxy,
       and the buffer inside it has to be copied out before the proxy is
       destroyed or the Float32Array is left pointing at freed WASM memory. */
    const obj = packed.toJs ? packed.toJs({ create_proxies: false }) : packed;
    const get = (k) => (obj instanceof Map ? obj.get(k) : obj[k]);
    volume = wrapVolume({
        r: get('r'), min: get('min'), max: get('max'), up: get('up'), unit: get('unit'),
        count: get('count'), cell: get('cell'), data: Uint8Array.from(get('data')),
    });
    if (packed.destroy) packed.destroy();

    volumeKey = key;
    volumeEquave = equaveRatio;
    return { ok: true, ms: performance.now() - t0 };
}
