/* =====================================================================
 *  THE MIRROR — the view, for the projector
 * =====================================================================
 *
 * The other half of mirror.js, running in the window it opens. Everything
 * under the panel in the app — whichever panes the stage is showing, and the
 * readout floating over them — is copied here every frame, scaled to fill this
 * window, with no panel and no pointer. The app's own window stays exactly as
 * it was, so the performer keeps every control while the room sees only the
 * picture.
 *
 * COPIED AS PICTURES, NOT RE-DRAWN.  The mirror is the very pixels the app
 * drew — the same frame, the same colours, the same chord lit — and costs the
 * app no second render, so nothing here can come to disagree with what the
 * performer is looking at. They are copied in one of two ways, because no one
 * way works for every pane:
 *
 *   drawn   a flat pane, or a 3D one that keeps its buffer, is drawn straight
 *           onto a canvas here on every frame of this window. A flat pane only
 *           repaints when something changes, and a stream of it would carry
 *           nothing at all until it did — a black projection of a still view.
 *   streamed  the tetrahedron clears its buffer once it is on screen, so a
 *           frame read from it afterwards is blank. It is captured as a live
 *           stream instead and played in a <video>; it repaints every frame,
 *           so the stream is never short of one.
 *
 * READ FROM THE APP, EVERY FRAME, BY THIS WINDOW.  Nothing is pushed across:
 * this side looks at the app's stage and follows it — a pane appearing, a
 * mode switching, the drawer shutting and the view widening. So the app can be
 * reloaded under a mirror that is already up and full-screen on the
 * projector, and the mirror simply picks the new page up.
 *
 * THE KEYBOARD STILL PLAYS.  Clicking here to fill the screen leaves this
 * window with the focus, so ⇧, S A T B and the rest would land here and do
 * nothing. They are handed on to the app as they arrive.
 * ------------------------------------------------------------------ */

const app = window.opener;
const frame = document.getElementById('frame');
const readout = document.getElementById('notation-display');
const note = document.getElementById('note');

/** One feed per canvas the app has shown, kept while the canvas lives. */
const feeds = new Map();   // canvas → { el, ctx } — ctx null for a stream

function feedFor(c, streamed) {
    let f = feeds.get(c);
    if (f) return f;
    if (streamed) {
        const v = document.createElement('video');
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        v.srcObject = c.captureStream();
        v.play().catch(() => {});
        f = { el: v, ctx: null };
    } else {
        const el = document.createElement('canvas');
        f = { el, ctx: el.getContext('2d') };
    }
    frame.insertBefore(f.el, readout);
    feeds.set(c, f);
    return f;
}
/** What was last written, so an unchanged frame writes nothing. */
const last = { frame: '', ground: '', html: null, cls: null, css: null, bright: null, theme: null };

function appDocument() {
    try { return app && !app.closed ? app.document : null; } catch (e) { return null; }
}

function follow() {
    requestAnimationFrame(follow);
    const doc = appDocument();
    const main = doc?.getElementById('main');
    if (!main) {
        say('Models is not open', false);
        return;
    }
    /* Nothing is touched until the app has set itself up and said so — its
       canvases are not its own yet before that. */
    let ask = null;
    try { ask = app.modelsMirror; } catch (e) {}
    if (!ask) return;
    if (note.textContent !== HINT) {
        say(HINT);
        if (document.fullscreenElement) note.classList.add('gone');
    }

    /* The stage's own size, laid out 1:1 and then scaled to fit — so every
       pane and the readout keep their places relative to each other. */
    const box = main.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    const s = Math.min(innerWidth / box.width, innerHeight / box.height);
    const sig = [box.width, box.height, innerWidth, innerHeight].join();
    if (sig !== last.frame) {
        last.frame = sig;
        frame.style.width = `${box.width}px`;
        frame.style.height = `${box.height}px`;
        frame.style.transform = `translate(${(innerWidth - box.width * s) / 2}px, `
            + `${(innerHeight - box.height * s) / 2}px) scale(${s})`;
    }

    /* Whatever the stage is showing. A pane that is hidden has no box, and
       its feed is hidden with it rather than dropped, so switching back is
       immediate. A canvas that has left the page — the app reloaded — takes
       its feed with it. */
    const shown = new Set();
    for (const c of doc.querySelectorAll('#stage canvas')) {
        const r = c.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const f = feedFor(c, ask.streamed(c));
        const v = f.el;
        if (f.ctx) {
            /* 'copy', so a pane with any transparency in it is replaced each
               frame rather than laid over the last. Set again after a resize,
               which resets the context. */
            if (v.width !== c.width || v.height !== c.height) {
                v.width = c.width;
                v.height = c.height;
                f.ctx.globalCompositeOperation = 'copy';
            }
            if (c.width && c.height) f.ctx.drawImage(c, 0, 0);
        }
        const place = `${r.left - box.left}px,${r.top - box.top}px,${r.width}px,${r.height}px`;
        if (v.dataset.place !== place) {
            v.dataset.place = place;
            v.style.left = `${r.left - box.left}px`;
            v.style.top = `${r.top - box.top}px`;
            v.style.width = `${r.width}px`;
            v.style.height = `${r.height}px`;
        }
        v.hidden = false;
        shown.add(c);
    }
    for (const [c, { el }] of feeds) {
        if (shown.has(c)) continue;
        /* Still on the page, only hidden: kept. A canvas of a page the app
           has since reloaded is still "connected" — to the old document — so
           it is asked which document it belongs to as well. */
        if (c.isConnected && c.ownerDocument === doc) { el.hidden = true; continue; }
        for (const t of el.srcObject?.getTracks() || []) t.stop();
        el.remove();
        feeds.delete(c);
    }

    /* The readout, as the app has it: the same markup under the same id, so
       the app's own stylesheet draws it here exactly as it draws it there. */
    const src = doc.getElementById('notation-display');
    if (src) {
        if (src.innerHTML !== last.html) readout.innerHTML = last.html = src.innerHTML;
        if (src.className !== last.cls) readout.className = last.cls = src.className;
        if (src.style.cssText !== last.css) readout.style.cssText = last.css = src.style.cssText;
    }
    const bright = doc.body.classList.contains('bright');
    if (bright !== last.bright) document.body.classList.toggle('bright', last.bright = bright);
    const theme = doc.documentElement.dataset.theme || '';
    if (theme !== last.theme) document.documentElement.dataset.theme = last.theme = theme;

    /* Past the edges of the stage, the ground the view is drawn on — so a
       projector wider than the laptop's view frames it in its own colour. */
    let ground = '#000000';
    try { ground = ask.ground() || ground; } catch (e) {}
    if (ground !== last.ground) document.body.style.background = last.ground = ground;
}

/* ---------------------------------------------------------------------
 *  Filling the screen
 * ------------------------------------------------------------------ */

const HINT = 'Click to fill this screen · Esc to leave';
let hideTimer = 0;

/** Show the note, and let it go a few seconds later unless told to keep it. */
function say(text, fade = true) {
    if (note.textContent !== text) note.textContent = text;
    note.classList.remove('gone');
    clearTimeout(hideTimer);
    if (fade) hideTimer = setTimeout(() => note.classList.add('gone'), 3000);
}

/* Full screen has to be asked for from inside this window, by a press made
   here — a browser will not let the app's window do it on this one's behalf.
   One click anywhere, and the browser puts it on whichever screen the window
   is standing on. */
document.addEventListener('click', () => {
    if (document.fullscreenElement) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) { clearTimeout(hideTimer); note.classList.add('gone'); }
    else say(HINT);
});
/* Out of full screen the note comes back when the pointer does, so a window
   left standing on the projector says how to fill it. */
document.addEventListener('pointermove', () => {
    if (!document.fullscreenElement && note.textContent === HINT) say(HINT);
});

/* ---------------------------------------------------------------------
 *  The keyboard, handed on
 * ------------------------------------------------------------------ */

for (const type of ['keydown', 'keyup']) {
    document.addEventListener(type, (ev) => {
        const doc = appDocument();
        if (!doc) return;
        /* Escape is the browser's while the window is full — it is how you get
           out — and it means nothing to the app's stage, so it stays here. */
        if (ev.key === 'Escape') return;
        const copy = new app.KeyboardEvent(type, {
            key: ev.key, code: ev.code, location: ev.location, repeat: ev.repeat,
            shiftKey: ev.shiftKey, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey,
            bubbles: true, cancelable: true,
        });
        doc.dispatchEvent(copy);
        if (copy.defaultPrevented) ev.preventDefault();
    });
}

/* ---------------------------------------------------------------------
 *  Saying it is here
 *
 *  The app lights its button from this, and keeps doing so across a reload of
 *  its own — it cannot otherwise know that a mirror it opened before the
 *  reload is still standing on the projector.
 * ------------------------------------------------------------------ */

function hello() {
    try { app?.postMessage({ modelsMirror: 'open' }, location.origin); } catch (e) {}
}
hello();
setInterval(hello, 1000);
window.addEventListener('pagehide', () => {
    try { app?.postMessage({ modelsMirror: 'closed' }, location.origin); } catch (e) {}
});

say(HINT);
requestAnimationFrame(follow);
