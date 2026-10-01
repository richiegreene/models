/* =====================================================================
 *  WHICH APP YOU ARE IN
 * =====================================================================
 *
 * Three modes now, over the same set: a LINE of dyads, a TRIANGLE of triads, a
 * TETRAHEDRON of tetrads. One voice more each time, and one dimension.
 *
 * WHY THIS IS ITS OWN MODULE.  With two modes the switch could live inside one
 * of them and read as "the other one" — and it did, in triad-mode.js. With
 * three that stops being true: a mode is no longer the complement of the mode
 * you are in, and a switch written from inside any one of them would have to
 * know about the other two. So the modes are registered here and the switch
 * knows only what every mode has in common:
 *
 *   title    what the drawers call themselves while it is up
 *   view     what the stage should be laying out
 *   resize   the panes it owns, when the stage changes size
 *   enter    what it needs on the way in — generating, fitting, rebuilding
 *   leave    what it must let go of on the way out
 *
 * Nothing in here imports a mode. The modes import this, and hand it their
 * hooks, in the same idiom the tetrahedron's builder was already registered
 * with — which is what keeps a fourth picture from being a fourth branch here.
 *
 * WHAT IS NOT A MODE SETTING.  The limit, the equave, the complexity measure,
 * the colormap, the synth and the notation are shared by all three and stay
 * where they are; see read-panel.js. A control that genuinely belongs to one
 * mode is marked `data-mode` in the markup and hidden by applyModeClasses
 * below, rather than removed, so it keeps its value across a switch and comes
 * back set the way you left it.
 * ------------------------------------------------------------------ */

import { stopChord } from './components/audio-engine.js';

/**
 * Which app you are in. The rest of the app branches on this and little else.
 *
 * Triads is where it opens — the mode with something to look at before you
 * have set anything. The other two are generated the first time they are asked
 * for, which is also several hundred milliseconds off the boot.
 */
export let appMode = 'triads'; // 'dyads' | 'triads' | 'tetrads'
export function setAppMode(v) { appMode = v; }

/** @type {Map<string, {title:string, view:()=>string, resize?:()=>void, enter?:()=>Promise<void>|void, leave?:()=>void}>} */
const modes = new Map();

/** A mode saying what it is and how to come and go from it. */
export function registerMode(name, hooks) { modes.set(name, hooks); }

/**
 * Anything outside the modes that has to follow the switch — the output
 * routing, which sends a dyad's two parts somewhere different from a tetrad's
 * four. Told after the panel has changed, at startup as well as on a switch.
 */
const followers = [];
export function onModeApplied(fn) { followers.push(fn); }

/**
 * Put the panel into one mode.
 *
 * Split out of switchMode because it has to happen at startup as well, where
 * there is no switch: the app opens in Triads, so the other two modes' controls
 * have to be already gone by the first paint rather than removed a moment
 * after it. The markup ships in the same state, so nothing flickers either.
 *
 * `data-mode` takes a LIST — "dyads triads" is a control the two gestural
 * modes share and the tetrahedron has no use for. Written as a list rather
 * than as two copies of the control, so there is one input for the rest of the
 * app to read by id.
 */
export function applyModeClasses(mode) {
    document.body.dataset.mode = mode;
    for (const el of document.querySelectorAll('[data-mode]')) {
        const owners = el.dataset.mode.trim().split(/\s+/);
        el.classList.toggle('mode-off', !owners.includes(mode));
    }
    for (const b of document.querySelectorAll('#mode-seg button')) {
        b.classList.toggle('on', b.dataset.v === mode);
    }
    const title = modes.get(mode)?.title ?? mode;
    for (const h of document.querySelectorAll('.drawer h1 .mode-name')) {
        h.textContent = title;
    }
    for (const fn of followers) fn(mode);
}

/**
 * Lay the stage out for the mode that is up, and tell every pane its size.
 *
 * All three are asked rather than only the one showing: a pane that was
 * resized while hidden has no size at all to draw itself at, and measuring is
 * cheap next to being wrong on the first frame back.
 */
export function layout() {
    const stage = document.getElementById('stage');
    if (stage) stage.dataset.view = modes.get(appMode)?.view?.() ?? 'tetra';
    for (const m of modes.values()) m.resize?.();
}

/**
 * Show one app instead of another.
 *
 * Everything that sounds is let go on the way across. All three modes address
 * the same synth voices by the same ids — a tetrad's bass, a triad's bass and a
 * dyad's lower voice are all voice 0 — so a mode change while something is
 * held would leave a note down with nothing left able to lift it.
 */
export async function switchMode(mode) {
    if (mode === appMode || !modes.has(mode)) return;
    stopChord();
    modes.get(appMode)?.leave?.();
    setAppMode(mode);

    applyModeClasses(mode);
    layout();
    await modes.get(mode)?.enter?.();
}

/** What the foot says. Shared, because the foot is. */
export function setStatus(text, busy = false) {
    const el = document.getElementById('panel-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('busy', busy);
}

/**
 * Two frames of breathing room before Pyodide takes the thread away.
 *
 * One to paint the status line, one for the browser to actually show it.
 * Everything that is about to block for a second says so first, and this is
 * what makes the saying visible.
 */
export function letStatusPaint() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
