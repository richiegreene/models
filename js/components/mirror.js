/* =====================================================================
 *  FULL SCREEN — the view in a window of its own
 * =====================================================================
 *
 * The button at the foot of the Display drawer. It opens mirror.html: the
 * stage and its readout, copied live and scaled to fill a window with no
 * panel and no pointer, for a projector. This window is left alone — the performer keeps
 * the drawers, the pointer and every control, and the room sees only what is
 * being played.
 *
 * ON THE OTHER SCREEN, WHERE THE BROWSER WILL SAY WHICH THAT IS.  With a
 * projector attached as a second display, Chrome can name the screens and
 * place a window on one of them, once the page has been allowed to; the
 * mirror is opened there at that screen's size, and one click on it fills it.
 * Without that — another browser, or the permission refused — it opens beside
 * this window and can be dragged across.
 *
 * The mirror does its own following; see mirror-window.js. This side only
 * opens it, shuts it, and answers the two questions it asks: what colour the
 * view is drawn on, for the margins, and which canvas has to be streamed
 * rather than drawn.
 * ------------------------------------------------------------------ */

import { currentLayoutMode, renderer } from '../globals.js';
import { colormapAt, groundCss } from '../calculations/color-mapping.js';
import { halftoneOn, groundCssHalftone } from '../calculations/halftone.js';
import { setStatus } from '../app-mode.js';

const $ = (id) => document.getElementById(id);

/** The mirror, while there is one. */
let mirror = null;

/** Latched while the mirror is open, as Rotate Continuously is while it turns. */
function light() {
    const open = !!mirror && !mirror.closed;
    const btn = $('mirror-toggle');
    if (!btn) return;
    btn.classList.toggle('latched', open);
    btn.setAttribute('aria-pressed', String(open));
}

/**
 * Put the window on a screen that is not this one, at that screen's size.
 * Opened first and moved after, because the move may have to wait on a
 * permission prompt, and a window opened that late is no longer the answer to
 * a click — the pop-up blocker would take it.
 */
async function place(w) {
    if (!window.screen.isExtended || !('getScreenDetails' in window)) return;
    try {
        const d = await window.getScreenDetails();
        const others = d.screens.filter((s) => s !== d.currentScreen);
        const there = others.find((s) => !s.isInternal) || others[0];
        if (!there || w.closed) return;
        w.moveTo(there.availLeft, there.availTop);
        w.resizeTo(there.availWidth, there.availHeight);
    } catch (e) {}
}

function toggle() {
    if (mirror && !mirror.closed) {
        mirror.close();
        mirror = null;
        light();
        return;
    }
    const w = Math.round(window.outerWidth * 0.6);
    const h = Math.round(window.outerHeight * 0.6);
    mirror = window.open('mirror.html', 'models-mirror', `popup,width=${w},height=${h}`);
    if (!mirror) {
        setStatus('pop-ups are blocked — allow them for this page to open the mirror');
        light();
        return;
    }
    light();
    place(mirror);
}

export function setupMirror() {
    /* What the mirror asks: the colour past the edges of the stage. The
       ground of the layout that is up, or the halftone's paper while that
       stands in for it. */
    window.modelsMirror = {
        ground: () => (halftoneOn() ? groundCssHalftone() : groundCss(colormapAt(currentLayoutMode).ground)),
        /* The tetrahedron's renderer clears its buffer once a frame is on
           screen, so a copy drawn from it later is blank. Answered here, by the
           app, because the mirror finding out for itself would mean asking the
           canvas for a context — and on a canvas the app has not set up yet,
           that question creates one, and takes the canvas from the app. */
        streamed: (canvas) => canvas === renderer?.domElement,
    };

    $('mirror-toggle').addEventListener('click', toggle);

    /* The mirror says it is there once a second, so a mirror opened before
       this page was reloaded is found again — and shut by the same button. */
    window.addEventListener('message', (ev) => {
        if (ev.origin !== location.origin || !ev.data?.modelsMirror) return;
        if (ev.data.modelsMirror === 'open') mirror = ev.source;
        else if (ev.source === mirror) mirror = null;
        light();
    });
    setInterval(light, 1000);
}
