/* =====================================================================
 *  AUDIO — the tetrad as four sounding voices
 * =====================================================================
 *
 * The oscillators are Keyboard Designer's: the same two timbre families over the same
 * four shapes, the same band-limited tables, the same ADSR, run a sample at a
 * time in ../synth/voice-processor.js. Nothing about the sound is defined
 * here — this file is only the part that is Models' own, which is how a
 * chord becomes four notes and what happens when the pointer moves to the
 * next one.
 *
 * FOUR IDS, HELD.  A voice is a part, not a note: id 0 is the bass for as
 * long as the app is sounding, and moving to the next tetrad leads that same
 * voice to its new pitch rather than stopping it and starting another. That
 * is what Enable Slide is — see voice.glide — and it is why the ids are fixed
 * rather than allocated per chord. With slide off the same four ids are
 * re-struck, so a voice still belongs to one part either way.
 * ------------------------------------------------------------------ */

import {
    initialBaseFreq, currentPivotVoiceIndex, enableSlide, slideDuration,
    lastPlayedFrequencies, lastPlayedRatios, playbackMode,
    setLastPlayedFrequencies, setLastPlayedRatios
} from '../globals.js';
import { updateNotationDisplay } from '../notation/notation-display.js';
import { notationDisplay, enableNotation } from '../globals.js';
import { sendMpeNoteOn, sendMpeNoteOff, sendMpePitchBendUpdate, releaseAllMpeNotes, isMpeNoteActive } from '../midi/midi-output.js';
import * as voice from '../synth/voice.js';
import { tetradArp, tetradArpOrder } from '../tetrads/tetrad-state.js';
import { onsets } from '../synth/arpeggio.js';

/** The four parts, bottom to top — the ids every message is addressed to. */
const VOICE_IDS = [0, 1, 2, 3];

/** Whether the browser voices are currently down, so a move can glide. */
let sounding = false;

/** Bring the audio up on a gesture. Safe to call as often as you like. */
export function initAudio() {
    voice.start();
}

/** Build the graph ahead of the first note, still silent — see voice.warm. */
export function warmAudio() {
    voice.warm();
}

export function setTimbre(v) { voice.setTimbre(v); }
export function setAdsr(e) { voice.setAdsr(e); }

export function playChord(ratioString) {
    // --- Determine Frequencies ---
    const ratio = ratioString.split(':').map(Number);
    if (ratio.length !== 4 || ratio.some(isNaN)) {
        console.error(`Invalid ratio format: ${ratioString}`);
        return;
    }

    let effectiveBaseFreq;
    if (lastPlayedFrequencies.length === 0) {
        effectiveBaseFreq = initialBaseFreq;
    } else {
        const pivotFreqFromPrevChord = lastPlayedFrequencies[currentPivotVoiceIndex];
        const ratioComponentAtPivot = ratio[currentPivotVoiceIndex];
        const firstRatioComponent = ratio[0];

        if (ratioComponentAtPivot === 0) {
            console.warn("Ratio component at pivot is zero, cannot calculate pivot. Using initial base frequency.");
            effectiveBaseFreq = initialBaseFreq;
        } else {
            effectiveBaseFreq = (pivotFreqFromPrevChord * firstRatioComponent) / ratioComponentAtPivot;
        }
    }

    const frequencies = ratio.map(r => effectiveBaseFreq * (r / ratio[0]));
    /* Only a strike is arpeggiated; a slide to the next point is a glide and
       has no onsets to spread. See arpeggio.js. */
    const lag = onsets(frequencies, tetradArp, tetradArpOrder);

    // --- Handle Browser Audio Playback ---
    if (playbackMode === 'browser' || playbackMode === 'both') {
        voice.start();
        if (enableSlide && sounding) {
            frequencies.forEach((freq, i) => voice.glide(VOICE_IDS[i], freq, slideDuration));
        } else {
            frequencies.forEach((freq, i) => voice.noteOn(VOICE_IDS[i], freq, 1, lag[i]));
        }
        sounding = true;
    } else if (sounding) {
        // Not in browser mode any more: let go of whatever is still down.
        voice.allOff();
        sounding = false;
    }

    // --- Handle MPE MIDI Playback ---
    if (playbackMode === 'mpe-midi' || playbackMode === 'both') {
        const currentChordIndices = new Set(frequencies.map((_, index) => index));

        // Get all currently active MPE note indices (from previous chord)
        const previousActiveIndices = new Set();
        for (let i = 0; i < 4; i++) {
            if (isMpeNoteActive(i)) {
                previousActiveIndices.add(i);
            }
        }

        // Turn off notes that were active but are no longer in the current chord
        previousActiveIndices.forEach(prevIndex => {
            if (!currentChordIndices.has(prevIndex)) {
                sendMpeNoteOff(prevIndex);
            }
        });

        // Process notes for the CURRENT chord
        frequencies.forEach((freq, index) => {
            if (previousActiveIndices.has(index)) {
                sendMpePitchBendUpdate(index, freq);
            } else {
                sendMpeNoteOn(index, freq, undefined, lag[index]);
            }
        });

        if (!enableSlide) {
            releaseAllMpeNotes();
        }
    } else {
        releaseAllMpeNotes();
    }

    setLastPlayedFrequencies(frequencies);
    setLastPlayedRatios(ratio);

    updateNotationDisplay(ratioString, frequencies, effectiveBaseFreq);
}

/**
 * Let go of the chord.
 *
 * `immediate` used to pick a shorter fade; the envelope's own release is the
 * fade now, so the flag is kept for its callers and means what it always
 * meant — the note is over — with the shape of the ending coming from the
 * ADSR editor rather than from here.
 *
 * Voice by voice rather than allOff, so an arpeggiated chord lets go in the
 * order it came in — each note as late as it was struck — and a quick hover
 * still hears the entrances it has not reached yet.
 */
export function stopChord(immediate = false) {
    if (sounding) {
        VOICE_IDS.forEach((id) => voice.noteOff(id));
        sounding = false;
    }

    if (playbackMode === 'mpe-midi' || playbackMode === 'both') {
        releaseAllMpeNotes();
    }

    if (notationDisplay && !enableNotation) {
        notationDisplay.style.display = 'none';
    }
}
