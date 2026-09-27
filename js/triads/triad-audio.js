/* =====================================================================
 *  TRIADS — three voices, one gesture
 * =====================================================================
 *
 * WHAT THIS REPLACES.  Isoharmonics sounds the triangle by generating a
 * looping buffer for the chord under the pointer, playing it, and fading the
 * previous one out over half a second. Every pointer move does this again. The
 * consequences are audible and all of them are the same consequence: a drag is
 * a stream of note-ons. Each new buffer starts its own attack, so the chord is
 * re-struck dozens of times a second; each old one is still fading, so up to
 * ten copies of nearly the same chord overlap and beat against each other; and
 * because a buffer has to be built before it can be heard, the pitch arrives
 * after the hand. A timer even nudges the cursor in a small circle while it is
 * held still, to keep re-triggering something that should simply be sustaining.
 *
 * WHAT HAPPENS HERE.  Three voices are struck ONCE, when the pointer goes
 * down, and they are not struck again until it is lifted and put down
 * somewhere else. Moving the pointer sends those same three running voices a
 * glide — see voice.js, and the per-sample interpolation in the worklet — so
 * the triad slides continuously through the field with one attack at the
 * beginning and one release at the end. Holding still is silence-free without
 * a timer, because a sustaining voice sustains.
 *
 * That is not merely tidier; it is what makes the mode work as an instrument.
 * The whole point of dragging across a dissonance surface is to hear the chord
 * bend through it, and an attack on every frame is exactly the event that
 * hides a bend.
 *
 * THE PIVOT.  One voice is held at a fixed pitch for the whole session and the
 * other two are measured from it, so that dragging changes the chord's shape
 * rather than sliding the whole thing up the spectrum. Which voice that is can
 * be changed while sounding: the new pivot inherits the pitch it currently
 * has, so the switch is silent and the chord does not jump.
 * ------------------------------------------------------------------ */

import * as voice from '../synth/voice.js';
import {
    initialBaseFreq, playbackMode, enableNotation, notationDisplay,
} from '../globals.js';
import {
    triadGlide, triadPivot, triadArp, triadArpOrder,
} from './triad-state.js';
import { onsets } from '../synth/arpeggio.js';
import { updateNotationDisplay } from '../notation/notation-display.js';
import {
    sendMpeNoteOn, sendMpeNoteOff, sendMpePitchBendUpdate, releaseAllMpeNotes,
    isMpeNoteActive,
} from '../midi/midi-output.js';

/** The three parts, bottom to top. Tetrads uses 0–3; only one mode sounds. */
const VOICE_IDS = [0, 1, 2];

/** The pitch the pivot voice is pinned to. Fixed until reset or re-pivoted. */
let pivotFreq = initialBaseFreq;

/** Whether the three voices are currently down. */
let sounding = false;

/** The last frequencies sent, so a pivot change can inherit one of them. */
let lastFreqs = [initialBaseFreq, initialBaseFreq, initialBaseFreq];

/** The move waiting for the next frame, and the frame it is waiting on. */
let pending = null;
let frame = 0;

/** What the readout last said, so it is not respelled sixty times a second. */
let lastLabel = '';
let lastNotationAt = 0;

/* ---------------------------------------------------------------------
 *  Cents to a chord
 * ------------------------------------------------------------------ */

/** The three pitches, in cents from the pivot, for the pivot currently set. */
function offsets(c1, c2) {
    if (triadPivot === 2) return [-c1 - c2, -c2, 0];
    if (triadPivot === 1) return [-c1, 0, c2];
    return [0, c1, c1 + c2];
}

function frequencies(c1, c2) {
    return offsets(c1, c2).map((cents) => pivotFreq * Math.pow(2, cents / 1200));
}

/** When each voice comes in if this triad is struck — see arpeggio.js. */
function lags(freqs) {
    return onsets(freqs, triadArp, triadArpOrder);
}

function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }

/**
 * The simplest just triad the pointer could be said to be on.
 *
 * A point on a continuous surface is not in just intonation, but the readout
 * and the notation engines only speak in enumerated chords — so the sounding
 * position has to be given a name. The obvious way is to approximate each
 * interval on its own and multiply the two fractions out, and it is wrong:
 * two independent convergents with denominators under a hundred multiply into
 * chords like 646:782:943, which is not a name for anything.
 *
 * So the search is over the CHORD rather than over its intervals. A triad
 * whose bottom voice is i has its other two fixed by the position — j is i·r1
 * rounded, k is i·r1·r2 — so walking i upward walks candidate triads in
 * order of increasing complexity, and the first one that lands within
 * tolerance of both intervals is the simplest reading there is. That is what
 * makes a major third read as 4:5:6.
 *
 * @returns {{label: string, error: number}} the chord, and how many cents the
 *          worse of its two intervals is from where the pointer actually is.
 */
export function spellTriad(c1, c2, tolerance = 4, maxBass = 96) {
    const r1 = Math.pow(2, c1 / 1200);
    const r2 = Math.pow(2, c2 / 1200);

    let best = null;
    let bestErr = Infinity;

    for (let i = 1; i <= maxBass; i++) {
        const j = Math.round(i * r1);
        const k = Math.round(i * r1 * r2);
        if (j < 1 || k < 1) continue;
        if (gcd(gcd(i, j), k) !== 1) continue;

        const err = Math.max(
            Math.abs(1200 * Math.log2((j / i) / r1)),
            Math.abs(1200 * Math.log2((k / j) / r2)),
        );
        if (err < bestErr) { bestErr = err; best = [i, j, k]; }
        /* First within tolerance wins: i is walked upward, so this is the
           simplest chord that fits and there is no point looking further. */
        if (err <= tolerance) break;
    }

    if (!best) return { label: '1:1:1', error: 0 };
    return { label: best.join(':'), error: bestErr };
}

/* ---------------------------------------------------------------------
 *  The three messages a gesture sends
 * ------------------------------------------------------------------ */

/**
 * Put the three voices down. The only attack in the whole drag — spread out,
 * if Arpeggiate says so, with the moves that follow leading a voice that has
 * not come in yet to where it will.
 */
export function triadNoteOn(c1, c2, label) {
    const freqs = frequencies(c1, c2);
    const lag = lags(freqs);
    lastFreqs = freqs;

    if (playbackMode === 'browser' || playbackMode === 'both') {
        voice.start();
        freqs.forEach((f, i) => voice.noteOn(VOICE_IDS[i], f, 1, lag[i]));
        sounding = true;
    }
    if (playbackMode === 'mpe-midi' || playbackMode === 'both') {
        freqs.forEach((f, i) => {
            if (isMpeNoteActive(i)) sendMpePitchBendUpdate(i, f);
            else sendMpeNoteOn(i, f, undefined, lag[i]);
        });
    }

    lastLabel = '';
    showReadout(c1, c2, freqs, label);
}

/**
 * Lead the sounding voices to a new chord.
 *
 * Coalesced to one message per voice per frame. A pointer can fire moves
 * faster than the display refreshes, and three glide messages per move would
 * only queue up work in the audio thread to describe a path the ear cannot
 * hear anyway — the frame is the finest grain that means anything.
 */
export function triadMove(c1, c2, label) {
    pending = { c1, c2, label };
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const p = pending;
        pending = null;
        if (!p) return;
        flush(p.c1, p.c2, p.label);
    });
}

function flush(c1, c2, label) {
    const freqs = frequencies(c1, c2);
    const lag = lags(freqs);
    lastFreqs = freqs;

    if (playbackMode === 'browser' || playbackMode === 'both') {
        if (sounding) {
            freqs.forEach((f, i) => voice.glide(VOICE_IDS[i], f, triadGlide));
        } else {
            voice.start();
            freqs.forEach((f, i) => voice.noteOn(VOICE_IDS[i], f, 1, lag[i]));
            sounding = true;
        }
    }
    if (playbackMode === 'mpe-midi' || playbackMode === 'both') {
        freqs.forEach((f, i) => {
            if (isMpeNoteActive(i)) sendMpePitchBendUpdate(i, f);
            else sendMpeNoteOn(i, f, undefined, lag[i]);
        });
    }

    showReadout(c1, c2, freqs, label);
}

/** Let go. The envelope's release is the ending — see the ADSR editor. */
export function triadNoteOff() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    pending = null;
    if (sounding) {
        VOICE_IDS.forEach((id) => voice.noteOff(id));
        sounding = false;
    }
    releaseAllMpeNotes();
    if (notationDisplay && !enableNotation) notationDisplay.style.display = 'none';
}

/** Everything off, now — what a mode switch and a panel reset need. */
export function triadAllOff() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    pending = null;
    sounding = false;
    voice.allOff();
    releaseAllMpeNotes();
}

/* ---------------------------------------------------------------------
 *  The pivot, and the reference pitch
 * ------------------------------------------------------------------ */

/**
 * Move the anchor to another voice without moving the sound.
 *
 * The new pivot takes the pitch that voice is already sounding, so the chord
 * is unchanged at the moment of the switch and only subsequent drags are
 * measured differently. Switching pivots mid-note is otherwise a lurch.
 */
export function rebindPivot(index) {
    const f = lastFreqs[index];
    if (f > 0) pivotFreq = f;
}

/** Put the next chord back on the app's fixed reference — what space does. */
export function resetPivotFreq() {
    pivotFreq = initialBaseFreq;
    lastFreqs = [initialBaseFreq, initialBaseFreq, initialBaseFreq];
}

export function currentFrequencies() { return lastFreqs.slice(); }

/* ---------------------------------------------------------------------
 *  The readout
 * ------------------------------------------------------------------ */

/**
 * Spell the chord under the pointer.
 *
 * Rate-limited and change-limited: spelling four voices in HEJI walks the
 * whole notation engine, which is far more than a frame's worth of work for a
 * name that only changes when the pointer crosses into a different ratio.
 */
function showReadout(c1, c2, freqs, label) {
    if (!enableNotation || !notationDisplay) return;
    const now = performance.now();
    if (now - lastNotationAt < 60) return;
    lastNotationAt = now;

    const text = label || spellTriad(c1, c2).label;
    if (text === lastLabel) return;
    lastLabel = text;
    updateNotationDisplay(text, freqs, freqs[0]);
}
