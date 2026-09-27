
import { enableSlide, slideDuration, playbackMode } from '../globals.js';

let midiAccess = null;
let midiOutput = null; // Currently selected MIDI output device
let midiOutputSelect = null; // HTML select element for MIDI output devices
let midiDeviceSelectorDiv = null; // HTML div containing the selector

export let mpeChannels = new Set(); // Keep track of active MPE channels (2-16)

const MPE_PITCH_BEND_RANGE = 48; // Common MPE pitch bend range in semitones
const MIDI_CHANNEL_START = 2;
const MIDI_CHANNEL_END = 16;
const MAX_MPE_CHANNELS = MIDI_CHANNEL_END - MIDI_CHANNEL_START + 1;

// Stores the mapping from a note's index within a chord
// to its assigned MIDI channel, current base MIDI note, and last sent pitch bend value.
// An arpeggiated note also carries `lag`, how many ms late it was struck, and
// `onAt`, the performance.now() time it comes in — see sendMpeNoteOn.
const activeMpeNotes = new Map(); // Map<index, { channel: number, midiNote: number, lastPitchBend: number, lag: number, onAt: number }>

/**
 * When a note's release is due: as late as the note was struck, so an
 * arpeggiated chord lets go in the order it came in and each note is held as
 * long as it would have been together. 0 is now — the Web MIDI timestamp for
 * "immediately".
 */
function releaseAt(noteInfo) {
    return noteInfo.lag > 0 ? performance.now() + noteInfo.lag : 0;
}

// Stores active pitch bend glides to allow cancellation
const activeGlides = new Map(); // Map<noteId, glideIntervalId>

// --- MIDI Utilities ---
function frequencyToMidi(frequency) {
    return 69 + 12 * Math.log2(frequency / 440.0);
}

function centDeviationToPitchBend(centsDeviation) {
    // Pitch bend range is +/- 8192 for full range (+/- MPE_PITCH_BEND_RANGE semitones)
    // 1 semitone = 100 cents
    // So, MPE_PITCH_BEND_RANGE semitones = MPE_PITCH_BEND_RANGE * 100 cents
    // Pitch Bend Value (PBV) = centsDeviation / (MPE_PITCH_BEND_RANGE * 100) * 8191 (for positive) or -8192 (for negative)
    // MIDI Pitch Bend Range is 0 to 16383, with 8192 being center.
    
    // Scale centsDeviation to +/- 1 range relative to MPE_PITCH_BEND_RANGE semitones
    const normalizedBend = centsDeviation / (MPE_PITCH_BEND_RANGE * 100);

    // Map to MIDI pitch bend value (0-16383)
    // Center (0 cents) is 8192
    // Max positive bend is 16383
    // Max negative bend is 0
    let pbValue = Math.round(8192 + (8191 * normalizedBend));

    // Clamp values to ensure they are within MIDI range
    pbValue = Math.max(0, Math.min(16383, pbValue));
    return pbValue;
}

function startPitchBendGlide(index, channel, startPitchBend, targetPitchBend, duration) {
    // Clear any existing glide for this note
    if (activeGlides.has(index)) {
        clearInterval(activeGlides.get(index));
        activeGlides.delete(index);
    }

    if (startPitchBend === targetPitchBend) {
        // No glide needed if already at target
        return;
    }

    const steps = 30; // Number of steps for the glide
    const intervalTime = duration * 1000 / steps; // Time in ms per step, ensure it's not zero for instant duration

    if (intervalTime <= 0) { // If duration is 0 or very small, just jump to target
        midiOutput.send([0xE0 | channel, targetPitchBend & 0x7F, (targetPitchBend >> 7) & 0x7F]);
        return;
    }

    let currentStep = 0;
    const glideIntervalId = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;

        if (progress >= 1) {
            // Ensure targetPitchBend is sent at the very end
            midiOutput.send([0xE0 | channel, targetPitchBend & 0x7F, (targetPitchBend >> 7) & 0x7F]);
            clearInterval(glideIntervalId);
            activeGlides.delete(index);
            return;
        }

        const interpolatedPitchBend = Math.round(startPitchBend + (targetPitchBend - startPitchBend) * progress);
        midiOutput.send([0xE0 | channel, interpolatedPitchBend & 0x7F, (interpolatedPitchBend >> 7) & 0x7F]);
    }, intervalTime);

    activeGlides.set(index, glideIntervalId);
}

// --- MPE Channel Management ---
function getAvailableMpeChannel() {
    for (let channel = MIDI_CHANNEL_START; channel <= MIDI_CHANNEL_END; channel++) {
        if (!mpeChannels.has(channel)) {
            mpeChannels.add(channel);
            return channel;
        }
    }
    return null; // No available channels
}

function releaseMpeChannel(channel) {
    mpeChannels.delete(channel);
}

// --- MIDI Device Selection UI ---
function updateMidiOutputDevices() {
    console.log("Updating MIDI output devices...");
    midiOutputSelect.innerHTML = ''; // Clear existing options
    const outputs = midiAccess.outputs.values();
    let hasDevices = false;
    let currentMidiOutputs = [];

    for (let output of outputs) {
        hasDevices = true;
        currentMidiOutputs.push({id: output.id, name: output.name});
        const option = document.createElement('option');
        option.value = output.id;
        option.textContent = output.name;
        midiOutputSelect.appendChild(option);
        console.log(`Found MIDI Output Device: ${output.name} (ID: ${output.id})`);
    }

    if (hasDevices) {
        midiDeviceSelectorDiv.style.display = 'flex';
        // Select the first device found by default, or the previously selected one if it still exists
        midiOutput = midiAccess.outputs.get(midiOutputSelect.value);
        if (midiOutput) {
            console.log(`Selected MIDI output: ${midiOutput.name} (ID: ${midiOutput.id})`);
        } else {
            console.warn("MIDI output device selected in dropdown is no longer available.");
            midiOutput = null; // Ensure it's null if not found
        }
    } else {
        midiDeviceSelectorDiv.style.display = 'none';
        midiOutput = null;
        const option = document.createElement('option');
        option.textContent = 'No devices found';
        midiOutputSelect.appendChild(option);
        console.warn("No MIDI output devices found.");
    }
    console.log("Finished updating MIDI output devices. Current midiOutput:", midiOutput);
}

// --- Web MIDI API Functions ---
export async function initMidiOutput() {
    console.log("Initializing MIDI output...");
    if (midiAccess) { // If midiAccess is already set, return early
        console.log("MIDI already initialized.");
        return;
    }
    if (!navigator.requestMIDIAccess) {
        console.warn("Web MIDI API is not supported in this browser.");
        return;
    }

    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        console.log("MIDI access granted.");

        midiOutputSelect = document.getElementById('midiOutputSelect');
        midiDeviceSelectorDiv = document.getElementById('midi-device-selector');
        
        // Ensure the div exists, if not, create a fallback/warning
        if (!midiOutputSelect || !midiDeviceSelectorDiv) {
            console.error("MIDI output selector UI elements not found in DOM.");
            return;
        }

        midiAccess.onstatechange = (event) => {
            console.log(`MIDI device state change: ${event.port.name} state: ${event.port.state}, type: ${event.port.type}`);
            if (event.port.type === 'output') {
                updateMidiOutputDevices();
            }
        };

        midiOutputSelect.addEventListener('change', (event) => {
            midiOutput = midiAccess.outputs.get(event.target.value);
            console.log(`MIDI output changed to: ${midiOutput ? midiOutput.name : 'None selected'}`);
        });

        updateMidiOutputDevices(); // Initial population of devices

    } catch (err) {
        console.error(`Failed to get MIDI access: ${err}`);
        if (midiDeviceSelectorDiv) {
            midiDeviceSelectorDiv.style.display = 'none'; // Hide if MIDI access fails
        }
    }
    console.log("MIDI output initialization complete. Current midiOutput:", midiOutput);
}

/**
 * Strike a note, now or `delay` seconds from now.
 *
 * A late note — an arpeggiated chord's — is sent at once with a Web MIDI
 * timestamp, so the device plays it on time however busy the page is. Its
 * channel is taken now, and a pitch update before it comes in is timestamped
 * to its entrance too, so it enters where the pointer has got to rather than
 * where it was struck.
 */
export function sendMpeNoteOn(index, frequency, velocity = 100, delay = 0) {
    console.log(`Attempting to send MPE Note On for index: ${index}, freq: ${frequency}. Current midiOutput:`, midiOutput);
    if (!midiOutput) {
        console.warn("No MIDI output selected or available. Cannot send Note On.");
        return;
    }

    let { channel, midiNote, lastPitchBend } = activeMpeNotes.get(index) || {};

    if (!channel) {
        channel = getAvailableMpeChannel();
        if (!channel) {
            console.warn("No free MPE channels to send note.");
            return;
        }
        console.log(`Assigned MPE channel ${channel} to index: ${index}`);
    }

    midiNote = Math.round(frequencyToMidi(frequency));
    const centsDeviation = (frequencyToMidi(frequency) - midiNote) * 100; // Cents deviation from the nearest MIDI note
    lastPitchBend = centDeviationToPitchBend(centsDeviation);

    const lag = delay > 0 ? delay * 1000 : 0;
    const onAt = lag > 0 ? performance.now() + lag : 0;
    if (activeGlides.has(index)) {
        clearInterval(activeGlides.get(index));
        activeGlides.delete(index);
    }

    // MPE Pitch Bend Sensitivity RPN message (Controller 101, 100, Data Entry MSB 0, LSB MPE_PITCH_BEND_RANGE)
    // This is typically sent once per channel (or when PB range changes)
    midiOutput.send([0xB0 | channel, 0x65, 0x00], onAt); // RPN MSB (Pitch Bend Range)
    midiOutput.send([0xB0 | channel, 0x64, 0x00], onAt); // RPN LSB (Pitch Bend Range)
    midiOutput.send([0xB0 | channel, 0x06, MPE_PITCH_BEND_RANGE], onAt); // Data Entry MSB (Pitch Bend Range in semitones)
    midiOutput.send([0xB0 | channel, 0x26, 0x00], onAt); // Data Entry LSB (usually 0)
    console.log(`Sent RPN for PB Range on channel ${channel}: ${MPE_PITCH_BEND_RANGE} semitones.`);

    const isMpePlayback = playbackMode === 'mpe-midi' || playbackMode === 'both';

    /* A late note enters on its pitch: the glide up from centre runs on a
       timer from now, and would be over before the note had begun. */
    if (enableSlide && isMpePlayback && slideDuration > 0 && !(lag > 0)) {
        // Send a center pitch bend immediately, then glide
        midiOutput.send([0xE0 | channel, 8192 & 0x7F, (8192 >> 7) & 0x7F]); // Center pitch bend
        startPitchBendGlide(index, channel, 8192, lastPitchBend, slideDuration);
        console.log(`MPE Note On (sliding): index=${index}, freq=${frequency}, MIDI Note=${midiNote}, initial PB=8192, target PB=${lastPitchBend}, channel=${channel}, velocity=${velocity}, slideDuration=${slideDuration}`);
    } else {
        // Send instantaneous pitch bend
        midiOutput.send([0xE0 | channel, lastPitchBend & 0x7F, (lastPitchBend >> 7) & 0x7F], onAt); // Pitch Bend
        console.log(`MPE Note On (instant): index=${index}, freq=${frequency}, MIDI Note=${midiNote}, PB=${lastPitchBend}, channel=${channel}, velocity=${velocity}`);
    }
    
    midiOutput.send([0x90 | channel, midiNote, velocity], onAt); // Note On

    activeMpeNotes.set(index, { channel, midiNote, lastPitchBend, lag, onAt });
}

export function sendMpePressure(channel, pressure) {
    if (!midiOutput) {
        console.warn("No MIDI output selected or available. Cannot send MPE Pressure.");
        return;
    }
    // Channel Pressure (Aftertouch) message: 0xD0 | channel, pressure
    // Pressure value is 0-127
    const clampedPressure = Math.max(0, Math.min(127, Math.round(pressure)));
    midiOutput.send([0xD0 | channel, clampedPressure]);
    // console.log(`Sent MPE Pressure: channel=${channel}, pressure=${clampedPressure}`);
}

export function sendMpeNoteOff(index, velocity = 64) {
    console.log(`Attempting to send MPE Note Off for index: ${index}. Current midiOutput:`, midiOutput);
    if (!midiOutput) {
        console.warn("No MIDI output selected or available. Cannot send Note Off.");
        return;
    }

    const noteInfo = activeMpeNotes.get(index);
    if (noteInfo) {
        const { channel, midiNote } = noteInfo;
        midiOutput.send([0x80 | channel, midiNote, velocity], releaseAt(noteInfo)); // Note Off
        releaseMpeChannel(channel);
        activeMpeNotes.delete(index);
        // Clear any ongoing glide for this note
        if (activeGlides.has(index)) {
            clearInterval(activeGlides.get(index));
            activeGlides.delete(index);
        }
        console.log(`MPE Note Off: index=${index}, MIDI Note=${midiNote}, channel=${channel}, velocity=${velocity}`);
    } else {
        console.warn(`Note info not found for index: ${index}. Cannot send Note Off.`);
    }
}

export function sendMpePitchBendUpdate(index, frequency) {
    console.log(`Attempting to send MPE Pitch Bend Update for index: ${index}, freq: ${frequency}. Current midiOutput:`, midiOutput);
    if (!midiOutput) {
        console.warn("No MIDI output selected or available. Cannot send Pitch Bend Update.");
        return;
    }

    const noteInfo = activeMpeNotes.get(index);
    if (noteInfo) {
        const { channel, midiNote } = noteInfo;
        const centsDeviation = (frequencyToMidi(frequency) - midiNote) * 100;
        const newPitchBend = centDeviationToPitchBend(centsDeviation);

        const isMpePlayback = playbackMode === 'mpe-midi' || playbackMode === 'both';

        if (newPitchBend !== noteInfo.lastPitchBend) {
            if (noteInfo.onAt > performance.now()) {
                /* Not in yet: the bend lands on its entrance, after the one
                   struck with it, so it comes in where the pointer now is. */
                midiOutput.send([0xE0 | channel, newPitchBend & 0x7F, (newPitchBend >> 7) & 0x7F], noteInfo.onAt);
            } else if (enableSlide && isMpePlayback && slideDuration > 0) {
                // Start a glide from the current pitch bend to the new target
                startPitchBendGlide(index, channel, noteInfo.lastPitchBend, newPitchBend, slideDuration);
                console.log(`MPE Pitch Bend Update (sliding): index=${index}, freq=${frequency}, MIDI Note=${midiNote}, PB from=${noteInfo.lastPitchBend} to=${newPitchBend}, channel=${channel}, slideDuration=${slideDuration}`);
            } else {
                midiOutput.send([0xE0 | channel, newPitchBend & 0x7F, (newPitchBend >> 7) & 0x7F]); // Pitch Bend
                console.log(`MPE Pitch Bend Update (instant): index=${index}, freq=${frequency}, MIDI Note=${midiNote}, PB=${newPitchBend}, channel=${channel}`);
            }
            noteInfo.lastPitchBend = newPitchBend;
            activeMpeNotes.set(index, noteInfo); // Update stored value
        } else {
            console.log(`Pitch bend value unchanged for index: ${index}, PB: ${newPitchBend}. No update sent.`);
        }
    } else {
        console.warn(`Note info not found for index: ${index}. Cannot send Pitch Bend Update.`);
    }
}

export function releaseAllMpeNotes() {
    console.log("Attempting to release all MPE notes. Current midiOutput:", midiOutput);
    if (!midiOutput) {
        console.warn("No MIDI output selected or available. Cannot release all MPE notes.");
        return;
    }

    activeMpeNotes.forEach((noteInfo, noteId) => {
        const { channel, midiNote } = noteInfo;
        midiOutput.send([0x80 | channel, midiNote, 0], releaseAt(noteInfo)); // Note Off with velocity 0
        releaseMpeChannel(channel);
        console.log(`MPE Note Off (all): noteId=${noteId}, MIDI Note=${midiNote}, channel=${channel}`);
    });
    activeMpeNotes.clear();
    mpeChannels.clear(); // Clear all assigned channels
    console.log("All MPE notes released.");
}

export function isMpeNoteActive(index) {
    return activeMpeNotes.has(index);
}
