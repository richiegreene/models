/* =====================================================================
 *  TETRADS — four voices under a hand
 * =====================================================================
 *
 * The tetrahedron has always sounded its points: hover a sprite with Shift
 * down and playChord in audio-engine.js strikes the four voices, leading
 * them from the previous chord through the pivot. That stays exactly as it
 * is. This is the OTHER way of playing it, which a cut through the entropy
 * field makes possible for the first time — dragging across a surface where
 * every point is a tetrad, most of them not in just intonation at all.
 *
 * It is the triangle's arrangement, over four voices instead of three: the
 * voices are struck ONCE, when the pointer goes down on the cut, and every
 * move after that is a glide message to voices that never stopped, so a
 * drag is one chord bending through the field rather than a stream of
 * re-attacks. See triad-audio.js for why that is the whole difference.
 *
 * THE PIVOT is the tetrahedron's own — S/A/T/B, in globals — and the two
 * ways of playing share it and share the reference pitch, so a drag picks up
 * where the last hovered point left off and a hover afterwards leads from
 * wherever the drag ended. One instrument, two gestures.
 * ------------------------------------------------------------------ */

import * as voice from '../synth/voice.js';
import {
    initialBaseFreq, playbackMode, enableNotation, notationDisplay,
    currentPivotVoiceIndex, lastPlayedFrequencies,
    setLastPlayedFrequencies, setLastPlayedRatios,
} from '../globals.js';
import { tetradGlide } from './tetrad-state.js';
import { updateNotationDisplay } from '../notation/notation-display.js';
import {
    sendMpeNoteOn, sendMpePitchBendUpdate, releaseAllMpeNotes, isMpeNoteActive,
} from '../midi/midi-output.js';

/** The four parts, bottom to top — the same ids playChord addresses. */
const VOICE_IDS = [0, 1, 2, 3];

let sounding = false;
let pivotFreq = initialBaseFreq;
let lastFreqs = [initialBaseFreq, initialBaseFreq, initialBaseFreq, initialBaseFreq];

let pending = null;
let frame = 0;
let lastLabel = '';
let lastNotationAt = 0;

/* ---------------------------------------------------------------------
 *  Cents to a chord
 * ------------------------------------------------------------------ */

/** The four pitches in cents from the pivot, for the pivot currently set. */
function offsets(c1, c2, c3) {
    const p = [0, c1, c1 + c2, c1 + c2 + c3];
    const anchor = p[Math.min(3, Math.max(0, currentPivotVoiceIndex))];
    return p.map((x) => x - anchor);
}

function frequencies(c1, c2, c3) {
    return offsets(c1, c2, c3).map((cents) => pivotFreq * Math.pow(2, cents / 1200));
}

function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }

/**
 * The simplest just tetrad the pointer could be said to be on.
 *
 * spellTriad's search, one voice longer: a tetrad whose bottom voice is i has
 * its other three fixed by the position, so walking i upward walks candidates
 * in order of complexity and the first within tolerance is the simplest
 * reading there is — which is what makes a major triad over an octave read
 * as 4:5:6:8 rather than 646:808:970:1292.
 */
export function spellTetrad(c1, c2, c3, tolerance = 4, maxBass = 96) {
    const r1 = Math.pow(2, c1 / 1200);
    const r2 = Math.pow(2, c2 / 1200);
    const r3 = Math.pow(2, c3 / 1200);

    let best = null;
    let bestErr = Infinity;

    for (let i = 1; i <= maxBass; i++) {
        const j = Math.round(i * r1);
        const k = Math.round(i * r1 * r2);
        const l = Math.round(i * r1 * r2 * r3);
        if (j < 1 || k < 1 || l < 1) continue;
        if (gcd(gcd(i, j), gcd(k, l)) !== 1) continue;

        const err = Math.max(
            Math.abs(1200 * Math.log2((j / i) / r1)),
            Math.abs(1200 * Math.log2((k / j) / r2)),
            Math.abs(1200 * Math.log2((l / k) / r3)),
        );
        if (err < bestErr) { bestErr = err; best = [i, j, k, l]; }
        if (err <= tolerance) break;
    }

    if (!best) return { label: '1:1:1:1', error: 0 };
    return { label: best.join(':'), error: bestErr };
}

/* ---------------------------------------------------------------------
 *  The three messages a gesture sends
 * ------------------------------------------------------------------ */

/**
 * Put the four voices down. The only attack in the whole drag.
 *
 * The pivot's pitch is inherited from whatever the tetrahedron last sounded —
 * a hovered point, or the previous drag — so the two gestures lead into each
 * other rather than each starting again from C3.
 */
export function tetradNoteOn(c1, c2, c3, label) {
    const prev = lastPlayedFrequencies;
    if (prev && prev.length === 4 && prev[currentPivotVoiceIndex] > 0) {
        pivotFreq = prev[currentPivotVoiceIndex];
    }
    const freqs = frequencies(c1, c2, c3);
    lastFreqs = freqs;

    if (playbackMode === 'browser' || playbackMode === 'both') {
        voice.start();
        freqs.forEach((f, i) => voice.noteOn(VOICE_IDS[i], f));
        sounding = true;
    }
    if (playbackMode === 'mpe-midi' || playbackMode === 'both') {
        freqs.forEach((f, i) => {
            if (isMpeNoteActive(i)) sendMpePitchBendUpdate(i, f);
            else sendMpeNoteOn(i, f);
        });
    }

    remember(freqs, label, c1, c2, c3);
    lastLabel = '';
    showReadout(c1, c2, c3, freqs, label);
}

/** Lead the sounding voices to a new chord — one message per voice per frame. */
export function tetradMove(c1, c2, c3, label) {
    pending = { c1, c2, c3, label };
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const p = pending;
        pending = null;
        if (!p) return;
        flush(p.c1, p.c2, p.c3, p.label);
    });
}

function flush(c1, c2, c3, label) {
    const freqs = frequencies(c1, c2, c3);
    lastFreqs = freqs;

    if (playbackMode === 'browser' || playbackMode === 'both') {
        if (sounding) {
            freqs.forEach((f, i) => voice.glide(VOICE_IDS[i], f, tetradGlide));
        } else {
            voice.start();
            freqs.forEach((f, i) => voice.noteOn(VOICE_IDS[i], f));
            sounding = true;
        }
    }
    if (playbackMode === 'mpe-midi' || playbackMode === 'both') {
        freqs.forEach((f, i) => {
            if (isMpeNoteActive(i)) sendMpePitchBendUpdate(i, f);
            else sendMpeNoteOn(i, f);
        });
    }

    remember(freqs, label, c1, c2, c3);
    showReadout(c1, c2, c3, freqs, label);
}

/** Let go. The envelope's release is the ending. */
export function tetradNoteOff() {
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
export function tetradAllOff() {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    pending = null;
    sounding = false;
    voice.allOff();
    releaseAllMpeNotes();
}

/**
 * Tell the tetrahedron's own player where the voices are, so a hovered point
 * after this drag is led from here — the same two globals playChord writes.
 */
function remember(freqs, label, c1, c2, c3) {
    setLastPlayedFrequencies(freqs);
    const text = label || spellTetrad(c1, c2, c3).label;
    setLastPlayedRatios(text.split(':').map(Number));
}

/** Put the next chord back on the app's fixed reference — what space does. */
export function resetTetradReference() {
    pivotFreq = initialBaseFreq;
    lastFreqs = [initialBaseFreq, initialBaseFreq, initialBaseFreq, initialBaseFreq];
}

export function currentTetradFrequencies() { return lastFreqs.slice(); }

/* ---------------------------------------------------------------------
 *  The readout
 * ------------------------------------------------------------------ */
function showReadout(c1, c2, c3, freqs, label) {
    if (!enableNotation || !notationDisplay) return;
    const now = performance.now();
    if (now - lastNotationAt < 60) return;
    lastNotationAt = now;

    const text = label || spellTetrad(c1, c2, c3).label;
    if (text === lastLabel) return;
    lastLabel = text;
    updateNotationDisplay(text, freqs, freqs[0]);
}
