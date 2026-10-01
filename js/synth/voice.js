/* =====================================================================
 *  THE SOUNDING END
 * =====================================================================
 *
 * One AudioContext, one worklet node, and what the worklet needs kept up to
 * date: which shape it is folding or reading, what the envelope is, and which
 * output each part leaves by. Everything expensive — the eleven band-limited tables — is
 * built here on the main thread and posted across, because the audio thread
 * has 128 samples to fill and no business doing additive synthesis inside
 * them.
 *
 * The context is not created until the first key goes down. A browser will not
 * start one without a gesture, and a page that asks for audio before anybody
 * asked to hear anything is a page that gets muted.
 * ------------------------------------------------------------------ */

import { FILTERED, FILTERED_MIN, familyOf } from './timbre.js';
import { wavetablesFor } from './tables.js';

let ctx = null;
let node = null;
let ready = null;          // the promise the worklet module is loading on
let timbre = FILTERED_MIN + 200;   // filtered saw
let adsr = { a: 0.016, d: 0.120, s: 0.66, r: 0.544 };

/**
 * HOW MANY OUTPUTS THE NODE HAS — always this many, whatever it is plugged
 * into. A worklet's channel count is fixed when it is built, and rebuilding
 * it would cut off whatever is sounding, so it is built wide once and the
 * destination decides how many of the channels actually leave: set to two it
 * keeps the first two and drops the rest, which is the stereo mix exactly as
 * it always was.
 */
export const MAX_OUTPUTS = 8;

/** Which parts each output carries — see the worklet's `masks`. Null: all. */
let masks = null;

/** Bring the audio up, once, on a gesture. Safe to call on every key. */
export function start() {
  if (ready) return ready;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return (ready = Promise.reject(new Error('no Web Audio')));
  ctx = new AC();
  configureDestination();
  /* Synchronously, while the gesture that called this is still on the stack —
     see resumeNow. */
  resumeNow();
  ready = ctx.audioWorklet.addModule('js/synth/voice-processor.js').then(() => {
    node = new AudioWorkletNode(ctx, 'xenachord-voice', {
      outputChannelCount: [MAX_OUTPUTS],
      // Configured at construction, so the first key cannot beat the first
      // message across the port — see the processor's constructor.
      processorOptions: { setup: setup() },
    });
    node.connect(ctx.destination);
    /* Whatever was played while the module was loading, in the order it was
       played — see send. */
    const q = queued; queued = [];
    for (const m of q) node.port.postMessage(m);
  });
  return ready;
}

/**
 * BUILD THE GRAPH BEFORE ANYBODY PLAYS IT.
 *
 * The context and the worklet used to be built by the first note, which is to
 * say DURING the gesture that was trying to sound one — and building them
 * takes a fetch and a module compile. The note's ON went into the queue, the
 * finger came up a moment later and put its OFF in behind it, and both were
 * delivered together the instant the node appeared: a note zero milliseconds
 * long, which is silence. The first tap on a fresh page was therefore always
 * lost, and everything after it worked, which is exactly what "I can't play
 * until I touch something in the Play tab" looks like from the outside — any
 * earlier interaction, on anything at all, gave the load time to finish.
 *
 * Creating a context without a gesture is allowed; what is not allowed is
 * RUNNING one, and this leaves it suspended for resumeNow to pick up on the
 * first press. So the page still makes no sound until it is asked to, and by
 * the time it is asked the graph it needs is already standing.
 */
export function warm() {
  start().then(() => bang('load')).catch(() => {});
}

/**
 * THE BANG — a nudge of the timbre, out and straight back.
 *
 * Everything above gets the engine STANDING; this proves it is awake. The
 * timbre is moved by half a unit and returned to where it was, which sends a
 * real shape message down the port and back again: the context is touched, the
 * worklet is given something to do, and the audio thread produces its first
 * output before anybody is listening for a note. On the browsers that need
 * shaking — a phone that has resumed a context on paper while its audio
 * session is still asleep — that is the difference between the first chord
 * sounding and the first chord being the one that wakes it up.
 *
 * It ENDS where it started, so the timbre the user hears is the timbre the
 * panel says, and it stays there until they move it themselves. Half a unit
 * cannot cross a family boundary, so a bang never turns a wavetable into a
 * filtered saw; within the wavetable family it costs one table build, cached
 * from then on, and within the filtered family it is two small messages.
 *
 * Fired at most once per occasion, and there are two: once when the page has
 * finished loading, and once on the first note anybody plays — the first tap
 * on the triangle or the surface. The first happens with no gesture behind it
 * and so can only do half the job; the second is inside a gesture and can do
 * all of it. Neither repeats.
 */
const BANG_STEP = 0.5;
const banged = new Set();

export function bang(occasion) {
  if (banged.has(occasion)) return;
  banged.add(occasion);
  resumeNow();
  const home = timbre;
  setTimbre(home + BANG_STEP);
  setTimbre(home);
}

/**
 * RESUME, NOW, IN THE GESTURE — the whole of why the phone was silent.
 *
 * A context created by a script starts suspended on a phone and is only
 * allowed to run if something resumes it from inside a user gesture. Resuming
 * it in the `then` above misses that window by a turn of the event loop: the
 * gesture is over by the time the worklet has loaded, and the resume is
 * refused. Whether the refusal was audible depended on how fast the module
 * came off the network and on whether the browser had already decided the page
 * was activated, which is why it looked random: the same tap worked on a warm
 * cache and did nothing on a cold one. Touching a slider first "fixed" it only
 * because that gesture created the context early enough for the load to finish
 * inside it.
 *
 * Called synchronously from every path that a gesture reaches, and cheap
 * enough to call on every note: a context already running is one property
 * read.
 */
function resumeNow() {
  if (!ctx || ctx.state === 'running') return;
  ctx.resume?.().catch(() => {});
  /* And the old iOS handshake on top of it. A resume alone is not always
     enough there — the audio session stays asleep until something has actually
     been PLAYED through it — so a single silent sample is started in the same
     gesture. It costs nothing, it is inaudible, and on the browsers that do not
     need it the resume above has already done the work. */
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) {}
}

/**
 * Post a message, or hold it until there is something to post it to.
 *
 * The first note of a session is played into a node that does not exist yet —
 * the worklet module is still loading — and a message dropped there is a note
 * that never sounds or, worse, a note-OFF that never arrives while its ON is
 * delivered later and hangs. Queued instead, the pair keeps its order and the
 * chord behaves the same whether it was the first of the session or the
 * hundredth.
 */
let queued = [];
function send(m) {
  if (node) node.port.postMessage(m);
  else queued.push(m);
}

/**
 * AND EVERY GESTURE AFTERWARDS GETS A CHANCE TO UNLOCK IT.
 *
 * One resume in one gesture is not enough on a phone. A context can be
 * suspended again by the system at any time — a call, a switch to another app,
 * the screen going off — and it comes back suspended with nothing having gone
 * wrong that the page can see. Every press on the document is therefore an
 * opportunity to put it back, taken only when it is actually needed.
 *
 * Registered in the capture phase so it runs before the handler that is about
 * to play something, and left registered for the life of the page rather than
 * `once`, because "the first gesture" is not the only one that matters. It
 * creates nothing on its own: with no context yet there is nothing to resume,
 * and the app still opens silent until somebody asks for a sound.
 */
for (const type of ['pointerdown', 'touchend', 'mousedown', 'keydown']) {
  window.addEventListener(type, resumeNow, { capture: true, passive: true });
}

/**
 * Everything the worklet needs to hold, as the messages that say it.
 *
 * One list, used both to configure a new node and to update a running one, so
 * a node built at any moment is in exactly the state a running one would have
 * been brought to.
 */
function setup() {
  const msgs = [];
  if (familyOf(timbre) === 'filtered') {
    const { drive, even } = FILTERED.shape(timbre);
    msgs.push({ t: 'shape', filtered: true, drive, even });
  } else {
    msgs.push({ t: 'shape', filtered: false, drive: 0, even: 0 });
    /* Copies, not the cached originals: posting a Float32Array structured-
     * clones it, and the cache has to survive to answer the next slider move
     * without rebuilding eleven tables. */
    msgs.push({ t: 'tables', mips: wavetablesFor(timbre, ctx.sampleRate).map((t) => t.slice()) });
  }
  msgs.push({ t: 'adsr', ...adsr });
  msgs.push({ t: 'route', masks });
  return msgs;
}

/** The same list, sent to a node that is already running. */
function push() {
  if (!node) return;
  for (const m of setup()) node.port.postMessage(m);
}

export function setTimbre(v) {
  timbre = v;
  push();
}

export function setAdsr(next) {
  adsr = { ...adsr, ...next };
  if (node) node.port.postMessage({ t: 'adsr', ...adsr });
}

/* =====================================================================
 *  WHERE THE SOUND GOES
 * =====================================================================
 *
 * Parts to outputs, so each player's in-ear feed carries that player's line.
 * One context and one node for all of them: the outputs share a sample clock,
 * so four parts on four channels stay as together as one chord in two.
 * ------------------------------------------------------------------ */

/**
 * Route the parts. `next` holds one mask per output, a bit per part — bit 0
 * the lowest voice — or is null for the stereo mix, every part on both sides.
 */
export function setRouting(next) {
  masks = next ? next.slice(0, MAX_OUTPUTS) : null;
  configureDestination();
  if (node) node.port.postMessage({ t: 'route', masks });
}

/**
 * Open as many of the device's channels as the routing addresses, each one
 * its own. 'discrete' is what keeps output 3 on output 3: the default,
 * 'speakers', would read four channels as quad and fold them down to two.
 * Asked again after a device change, because the count is the device's.
 */
function configureDestination() {
  if (!ctx) return;
  const d = ctx.destination;
  const want = masks ? masks.length : 2;
  const n = Math.max(1, Math.min(want, d.maxChannelCount || 2));
  try {
    d.channelInterpretation = 'discrete';
    if (d.channelCount !== n) d.channelCount = n;
  } catch (e) {}
}

/** How many channels the current device offers, as far as the browser says. */
export function deviceChannels() {
  start().catch(() => {});
  return ctx?.destination?.maxChannelCount || 2;
}

/** Whether this browser lets a page pick its own output device. */
export function canChooseDevice() {
  const AC = window.AudioContext || window.webkitAudioContext;
  return !!AC && typeof AC.prototype.setSinkId === 'function';
}

/**
 * Play through one device rather than the system's. '' is the system output.
 * Resolves to the channel count the new device offers; rejects if the browser
 * refused, which leaves the context on whatever it was on before.
 */
export async function setDevice(id) {
  start().catch(() => {});
  if (!ctx || typeof ctx.setSinkId !== 'function') return deviceChannels();
  if ((ctx.sinkId || '') !== (id || '')) await ctx.setSinkId(id || '');
  configureDestination();
  return deviceChannels();
}

/**
 * Strike a voice, now or `delay` seconds from now.
 *
 * A delay is how a chord is arpeggiated: every voice is sent at once and the
 * worklet starts each one late, to the sample — see its 'on'. The voice's
 * release is later by the same amount, so each note keeps its whole
 * envelope, and any glide sent while it waits moves where it will come in.
 */
export function noteOn(id, freq, vel = 1, delay = 0) {
  if (!(freq > 0)) return;
  /* Both of these have to happen on THIS stack, not in a callback: start
     builds the context inside the gesture that asked for the note, and
     resumeNow unlocks it there. The message itself can wait for the worklet. */
  start().catch(() => {});
  resumeNow();
  /* A sign of use, and the one bang that happens inside a gesture — see bang.
     Before the note, so the engine is awake by the time it arrives. */
  bang('first-note');
  send({ t: 'on', id, freq, vel, delay });
}

export function noteOff(id) {
  send({ t: 'off', id });
}

/**
 * Slide a sounding voice to a new pitch over `time` seconds.
 *
 * Tetrads moves between chords rather than between notes: the four voices are
 * held down and their frequencies are led to the next tetrad, which is the
 * whole reason the shape under the pointer reads as a progression. A voice
 * that were stopped and restarted would re-attack four times a second, so the
 * glide is a message to the running voice instead of a new note.
 */
export function glide(id, freq, time) {
  if (!(freq > 0)) return;
  /* Queued behind the note it moves, like an OFF: a glide dropped while the
     worklet loads would leave a late entrance coming in where the pointer
     WAS rather than where it is. */
  send({ t: 'glide', id, freq, time });
}

/** Whether a voice with this id is still sounding — asked before gliding. */
export function isRunning() {
  return !!node;
}

export function allOff() {
  /* Through the queue as well, so it cannot overtake the notes it is meant to
     be stopping — an allOff dropped ahead of a queued ON leaves that note
     sounding with nothing left to stop it. */
  send({ t: 'allOff' });
}
