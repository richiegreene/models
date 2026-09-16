/* =====================================================================
 *  TETRADS — the field, as a mode
 * =====================================================================
 *
 * The tetrahedron's mode is registered in ui-handlers.js, where applyTetrads
 * lives, and that stays as it is: the sprites, the hover, the pivot and the
 * export are the app's oldest code and they are not what this file is about.
 * This is what the entropy field adds — asking Python for it, putting it on
 * the card, cutting it, and the gesture that plays the cut — held together
 * the way triad-mode.js holds the triangle's two panes together:
 *
 *   ONE CURSOR   the cut reports a hit here and draws nothing itself. The
 *                hit goes into `cursor`, to the four voices, and the bead is
 *                drawn from it next frame, so the chord marked is the chord
 *                sounding.
 *   ONE LOOP     the tetrahedron's own animate() asks frameField() for the
 *                per-frame work — the eye's position for the ray march, the
 *                sweep, the bead — so there is still one render of one scene.
 * ------------------------------------------------------------------ */

import { setStatus, letStatusPaint } from '../app-mode.js';
import {
    tetradModel, setTetradModel, setCursor, setCursorLive, theParams,
} from './tetrad-state.js';
import {
    attachField, rebuildField, clearField, restyleField, restyleBody, updateSlice,
    syncVisibility, fieldSupported, frameField, fieldDragging,
} from './tetrad-field.js';
import { addFrameHook, setHoverGuard } from '../components/three-visualizer.js';
import { generateVolume, currentVolume, clearVolume, volumeIsStale } from './tetrad-volume.js';
import {
    tetradNoteOn, tetradMove, tetradNoteOff, tetradAllOff, spellTetrad,
} from './tetrad-audio.js';
import { readPanel } from '../utils/read-panel.js';
import { currentTetradSet } from '../calculations/tetrahedron-updater.js';

/* ---------------------------------------------------------------------
 *  Setting up
 * ------------------------------------------------------------------ */

/**
 * Attach the field to the tetrahedron's scene. Called once the scene exists —
 * after initThreeJS — and before the first set is built.
 *
 * @param {(t:number)=>void} onSweep  the panel's slider, kept in step with a
 *        sweeping cut
 */
export function initTetrads(onSweep) {
    attachField(gesture, () => ({
        equaveRatio: readPanel().equaveRatio,
        tetrads: currentTetradSet(),
    }), onSweep);
    addFrameHook(frameField);
    setHoverGuard(fieldDragging);
}

/* ---------------------------------------------------------------------
 *  Gestures
 * ------------------------------------------------------------------ */
function gesture(kind, hit) {
    if (kind === 'up') {
        setCursorLive(false);
        tetradNoteOff();
        return;
    }
    if (!hit) return;

    setCursor(hit.c1, hit.c2, hit.c3);
    setCursorLive(true);
    const label = hit.label || spellTetrad(hit.c1, hit.c2, hit.c3).label;

    if (kind === 'down') tetradNoteOn(hit.c1, hit.c2, hit.c3, label);
    else tetradMove(hit.c1, hit.c2, hit.c3, label);
}

/* ---------------------------------------------------------------------
 *  The field
 * ------------------------------------------------------------------ */

/**
 * Build the field for the model the panel is set to, or take it down.
 *
 * The one thing in Tetrads that can take a couple of seconds: Pyodide runs on
 * the page's thread, and a 112³ volume is a few million cells through three
 * FFTs. So it is asked for through the settle timer like the triangle's
 * surface, never as a side effect of a slider mid-drag.
 */
export async function generateTetradField(model) {
    setTetradModel(model);
    if (model === 'blank') {
        clearVolume();
        clearField();
        setStatus(describeSet());
        return;
    }
    if (!fieldSupported()) {
        clearVolume();
        clearField();
        setStatus('harmonic entropy needs WebGL2, which this browser does not offer');
        return;
    }

    const o = readPanel();
    setStatus('generating…', true);
    await letStatusPaint();

    const res = await generateVolume({ equaveRatio: o.equaveRatio });

    if (!res.ok) {
        clearField();
        setStatus(res.error || 'could not generate');
        return;
    }
    rebuildField();
    restyleField();
    restyleBody();
    updateSlice();
    if (!res.cached) lastMs = res.ms;
    setStatus(describeSet());
}

/** What the last field cost, for the foot. */
let lastMs = 0;

/**
 * The field on screen against the panel's equave — what the set's refresh
 * asks after an equave change, since a field for another equave is a wrong
 * diagram rather than a stale one.
 */
export async function refreshFieldIfStale() {
    const o = readPanel();
    if (tetradModel !== 'blank' && volumeIsStale(o.equaveRatio)) {
        await generateTetradField(tetradModel);
    }
}

/**
 * What the panel has produced, as the foot says it.
 *
 * Short, because in Tetrads the foot shares its line with the Play button:
 * the count, the model, what it cost — and a mark when the grid is too coarse
 * for the order, with the sentence behind it in the foot's own tooltip, since
 * a sentence would not fit and a symbol alone would not explain.
 */
export function describeSet() {
    const n = currentTetradSet().length;
    const vol = currentVolume();
    const foot = document.getElementById('panel-status');
    if (tetradModel === 'he' && vol) {
        const warn = resolutionWarning(vol);
        const cost = lastMs ? ` · ${(lastMs / 1000).toFixed(1)}s` : '';
        if (foot) {
            foot.title = `${vol.r}³ cells of ${vol.cell.toFixed(1)} ¢ over ${vol.count.toLocaleString()} tetrads`
                + (warn ? `. ${warn}` : '');
        }
        return `${n} tetrads · entropy${cost}${warn ? ' ⚠' : ''}`;
    }
    if (foot) foot.title = 'What the panel has just produced';
    return `${n} tetrads`;
}

/**
 * The sentence for the foot's tooltip when the grid is too coarse for the
 * order asked for, or nothing.
 *
 * A Rényi order a is taken with the spreading function raised to the a-th
 * power, whose width is s/√a — so at order 7 a 17 ¢ spread is effectively a
 * 6.4 ¢ one, and a 10.7 ¢ cell cannot resolve it. The line and the triangle
 * have cells far finer than this; the volume does not, and says so rather
 * than quietly drawing an aliased field. The line is drawn where the kernel
 * is under about three quarters of a cell wide, which is where its sampling
 * starts to alias appreciably.
 */
function resolutionWarning(vol) {
    const a = Number(theParams.alpha) || 1;
    const effective = Number(theParams.spread) / Math.sqrt(Math.max(1, a));
    return vol.cell > effective * 1.35
        ? `The cell (${vol.cell.toFixed(1)} ¢) is coarser than the kernel the order is taken with (s/√a = ${effective.toFixed(1)} ¢): raise Resolution or lower Order.`
        : '';
}

/* ---------------------------------------------------------------------
 *  Things the panel does to the mode
 * ------------------------------------------------------------------ */

/** The cut moved, or a switch was pressed: the picture changes and nothing else. */
export function applySlice() { updateSlice(); syncVisibility(); }
export function applyBody() { restyleBody(); }
export function applyStyle() { restyleField(); }

/** Everything off — what a mode switch needs. */
export function leaveTetrads() {
    tetradAllOff();
    setCursorLive(false);
}

export { currentVolume };
