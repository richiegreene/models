/* =====================================================================
 *  DYADS — two voices, one gesture
 * =====================================================================
 *
 * The triangle's arrangement over two voices rather than three, and for the
 * same reason: the voices are struck ONCE, when the pointer goes down, and
 * every move after that is a glide message to voices that never stopped. See
 * triad-audio.js, which says at length why that matters — a drag across a
 * dissonance curve is the chord bending through it, and an attack on every
 * frame is exactly the event that hides a bend.
 *
 * WHAT IS DIFFERENT ABOUT TWO.  A dyad has one interval, so the pivot is not a
 * refinement, it is the whole question of what the gesture means. Hold the
 * lower voice and dragging right takes the upper one up; hold the upper and
 * the same drag takes the LOWER one down. Those are different musical
 * gestures — one opens upward, the other opens downward — and they sound
 * different even though the interval is identical, which is exactly what a
 * mode about intervals should let you hear.
 * ------------------------------------------------------------------ */

import * as voice from '../synth/voice.js';
import {
    initialBaseFreq, playbackMode, enableNotation, notationDisplay,
} from '../globals.js';
import { dyadGlide, dyadPivot, dyadArp, dyadArpOrder } from './dyad-state.js';
import { onsets } from '../synth/arpeggio.js';
import { updateNotationDisplay } from '../notation/notation-display.js';
import {
    sendMpeNoteOn, sendMpePitchBendUpdate, releaseAllMpeNotes, isMpeNoteActive,
} from '../midi/midi-output.js';

/** The two parts, low to high. The other modes use 0-2 and 0-3; only one
 *  mode sounds at a time, so the ids are shared and a switch lets go first. */
const VOICE_IDS = [0, 1];

/** The pitch the pivot voice is pinned to. Fixed until reset or re-pivoted. */
let pivotFreq = initialBaseFreq;

let sounding = false;
let lastFreqs = [initialBaseFreq, initialBaseFreq];

/** The move waiting for the next frame, and the frame it is waiting on. */
let pending = null;
let frame = 0;

let lastLabel = '';
let lastNotationAt = 0;

/** The two pitches, in cents from the pivot, for the pivot currently set. */
function offsets(c) {
    return dyadPivot === 1 ? [-c, 0] : [0, c];
}

function frequencies(c) {
    return offsets(c).map((cents) => pivotFreq * Math.pow(2, cents / 1200));
}

/** When each voice comes in if this dyad is struck — see arpeggio.js. */
function lags(freqs) {
    return onsets(freqs, dyadArp, dyadArpOrder);
}

function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }

/**
 * The simplest just dyad the pointer could be said to be on.
 *
 * A point on a continuous curve is not in just intonation, but the readout and
 * the notation engines only speak in enumerated chords, so the sounding
 * position has to be given a name. Walking the lower number upward walks the
 * candidates in order of increasing complexity, so the first one that lands
 * within tolerance is the simplest reading there is — which is what makes a
 * major third read as 4:5 rather than as some convergent with a denominator in
 * the hundreds.
 *
 * @returns {{label: string, error: number}} the interval, and how many cents
 *          it is from where the pointer actually is.
 */
export function spellDyad(c, tolerance = 4, maxLower = 256) {
    const r = Math.pow(2, c / 1200);
    let best = null;
    let bestErr = Infinity;

    for (let i = 1; i <= maxLower; i++) {
        const j = Math.round(i * r);
        if (j < 1) continue;
        if (gcd(i, j) !== 1) continue;
        const err = Math.abs(1200 * Math.log2((j / i) / r));
        if (err < bestErr) { bestErr = err; best = [i, j]; }
        if (err <= tolerance) break;
    }

    if (!best) return { label: '1:1', error: 0 };
    return { label: best.join(':'), error: bestErr };
}

/* ---------------------------------------------------------------------
 *  The three messages a gesture sends
 * ------------------------------------------------------------------ */

/**
 * Put the two voices down. The only attack in the whole drag — spread out,
 * if Arpeggiate says so, with the moves that follow leading a voice that has
 * not come in yet to where it will.
 */
export function dyadNoteOn(c, label) {
    const freqs = frequencies(c);
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
    showReadout(c, freqs, label);
}

/**
 * Lead the sounding voices to a new interval.
 *
 * Coalesced to one message per voice per frame: a pointer fires moves faster
 * than the display refreshes, and the extra ones would only queue work in the
 * audio thread to describe a path the ear cannot hear.
 */
export function dyadMove(c, label) {
    pending = { c, label };
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const p = pending;
        pending = null;
        if (!p) return;
        flush(p.c, p.label);
    });
}

function flush(c, label) {
    const freqs = frequencies(c);
    const lag = lags(freqs);
    lastFreqs = freqs;

    if (playbackMode === 'browser' || playbackMode === 'both') {
        if (sounding) {
            freqs.forEach((f, i) => voice.glide(VOICE_IDS[i], f, dyadGlide));
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

    showReadout(c, freqs, label);
}

/** Let go. The envelope's release is the ending — see the ADSR editor. */
export function dyadNoteOff() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    pending = null;
    if (sounding) {
        VOICE_IDS.forEach((id) => voice.noteOff(id));
        sounding = false;
    }
    releaseAllMpeNotes();
    if (notationDisplay && !enableNotation) notationDisplay.style.display = 'none';
}

/** Everything off, now — what a mode switch needs. */
export function dyadAllOff() {
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
 * Move the anchor to the other voice without moving the sound.
 *
 * The new pivot takes the pitch that voice is already sounding, so the dyad is
 * unchanged at the moment of the switch and only subsequent drags are measured
 * differently. Switching mid-note is otherwise a lurch.
 */
export function rebindPivot(index) {
    const f = lastFreqs[index];
    if (f > 0) pivotFreq = f;
}

/** Put the next dyad back on the app's fixed reference — what space does. */
export function resetPivotFreq() {
    pivotFreq = initialBaseFreq;
    lastFreqs = [initialBaseFreq, initialBaseFreq];
}

export function currentFrequencies() { return lastFreqs.slice(); }

/* ---------------------------------------------------------------------
 *  The readout
 * ------------------------------------------------------------------ */

/**
 * Spell the interval under the pointer.
 *
 * Rate-limited and change-limited: spelling in HEJI walks the whole notation
 * engine, which is far more than a frame's worth of work for a name that only
 * changes when the pointer crosses into a different ratio.
 */
function showReadout(c, freqs, label) {
    if (!enableNotation || !notationDisplay) return;
    const now = performance.now();
    if (now - lastNotationAt < 60) return;
    lastNotationAt = now;

    const text = label || spellDyad(c).label;
    if (text === lastLabel) return;
    lastLabel = text;
    updateNotationDisplay(text, freqs, freqs[0]);
}
