/* =====================================================================
 *  SETTINGS — where the sound goes
 * =====================================================================
 *
 * The in-browser synth, sent to one device and split by part: each output
 * carries the parts lit on its row, so four players on four in-ear feeds each
 * hear their own line. The routing itself happens in the worklet — see
 * `masks` in ../synth/voice-processor.js — and this is the drawer that says
 * what it should be.
 *
 * THREE ROUTINGS, ONE MECHANISM.  Stereo Mix is the app as it always was,
 * every part in both channels. Split Stereo and Multichannel both send output
 * N to the device's Nth channel; they differ only in what the rows are called.
 * A rig that takes stereo pairs apart into mono feeds thinks in pairs — 1 L,
 * 1 R, 2 L, 2 R — and an interface numbers its outputs 1, 2, 3, 4. Same four
 * channels, named the way the cables are labelled.
 *
 * EACH MODE KEEPS ITS OWN ROWS.  A dyad has two parts and a tetrad four, and
 * which player doubles which line when there are more players than parts is a
 * decision about that mode, not about the device. So a dyad's doubling is set
 * once and left alone by the tetrads, and the rows always show the parts of
 * the mode that is up.
 *
 * Kept in this browser between visits, device included: the setup is made
 * once, before the performance, and has to be there when the page is opened
 * on the night.
 * ------------------------------------------------------------------ */

import * as voice from '../synth/voice.js';
import { appMode, onModeApplied } from '../app-mode.js';

const $ = (id) => document.getElementById(id);

/* Each mode's parts as its row shows them: highest at the left, in the
 * letters the pivot rows use. The number is the voice id — 0 the lowest. */
const PARTS = {
    dyads: [['S', 1], ['T', 0]],
    triads: [['S', 2], ['A', 1], ['T', 0]],
    tetrads: [['S', 3], ['A', 2], ['T', 1], ['B', 0]],
};
const PART_NAMES = {
    dyads: { S: 'the upper voice', T: 'the lower voice' },
    triads: { S: 'the soprano', A: 'the alto', T: 'the tenor' },
    tetrads: { S: 'the soprano', A: 'the alto', T: 'the tenor', B: 'the bass' },
};

/** One part per output, top voice first, and nothing past the last part. */
function oneEach(mode) {
    const r = new Array(voice.MAX_OUTPUTS).fill(0);
    PARTS[mode].forEach(([, id], i) => { r[i] = 1 << id; });
    return r;
}

/** Every part of the mode, as a mask — what a stored row is trimmed to. */
const allParts = (mode) => PARTS[mode].reduce((m, [, id]) => m | (1 << id), 0);

const STORE = 'models.outputs.v1';
const O = {
    layout: 'mix',     // 'mix' | 'split' | 'multi'
    device: '',        // '' is the system output
    deviceName: '',    // said while the device is unplugged
    routes: { dyads: oneEach('dyads'), triads: oneEach('triads'), tetrads: oneEach('tetrads') },
};
try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (['mix', 'split', 'multi'].includes(s.layout)) O.layout = s.layout;
    if (typeof s.device === 'string') O.device = s.device;
    if (typeof s.deviceName === 'string') O.deviceName = s.deviceName;
    for (const m of Object.keys(PARTS)) {
        const r = s.routes?.[m];
        if (!Array.isArray(r)) continue;
        O.routes[m] = O.routes[m].map((d, i) => (Number.isInteger(r[i]) ? r[i] & allParts(m) : d));
    }
} catch (e) {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(O)); } catch (e) {} };

/** The channels the device offers, as the browser last reported them. */
let channels = 2;
/** False while the chosen device is not there and the system output stands in. */
let deviceFound = true;
/** Whether the browser has named its devices — until it has, it lists none. */
let named = true;

/**
 * How many rows there are: one per channel the device has, up to the node's
 * eight. In pairs an odd channel out has no partner, so it is left off.
 */
function rowCount() {
    const n = Math.max(1, Math.min(voice.MAX_OUTPUTS, channels));
    return O.layout === 'split' && n > 1 ? n - (n % 2) : n;
}

function rowName(i) {
    return O.layout === 'split' ? `${(i >> 1) + 1} ${i % 2 ? 'R' : 'L'}` : `${i + 1}`;
}

/** Tell the synth. Only the rows the device has are sent. */
function apply() {
    voice.setRouting(O.layout === 'mix' ? null : O.routes[appMode].slice(0, rowCount()));
}

/** Draw the drawer from the state — all of it, every time. It is small. */
function render() {
    for (const b of $('out-layout').querySelectorAll('button')) {
        b.classList.toggle('on', b.dataset.v === O.layout);
    }
    $('out-ch').textContent = `${channels} ch`;

    const routed = O.layout !== 'mix';
    $('out-routing').hidden = !routed;

    const parts = PARTS[appMode];
    const route = O.routes[appMode];
    const n = rowCount();
    const rows = $('out-rows');
    rows.replaceChildren();
    for (let i = 0; i < n; i++) {
        const row = document.createElement('div');
        row.className = 'route-row';
        if (O.layout === 'split' && i % 2) row.classList.add('pair-end');
        const name = document.createElement('span');
        name.className = 'route-out';
        name.textContent = rowName(i);
        const seg = document.createElement('div');
        seg.className = 'seg';
        for (const [letter, id] of parts) {
            const b = document.createElement('button');
            b.textContent = letter;
            b.dataset.row = i;
            b.dataset.id = id;
            b.classList.toggle('on', !!(route[i] & (1 << id)));
            b.title = `Send ${PART_NAMES[appMode][letter]} to output ${rowName(i)}`;
            seg.appendChild(b);
        }
        row.append(name, seg);
        rows.appendChild(row);
    }

    /* What a player would otherwise find out on stage: a part going nowhere,
       or a device with fewer channels than the chord has parts. */
    const lost = parts
        .filter(([, id]) => !route.slice(0, n).some((m) => m & (1 << id)))
        .map(([letter]) => letter);
    const says = [];
    if (n < parts.length) says.push(`This device opens ${n} channel${n === 1 ? '' : 's'}, for ${parts.length} parts.`);
    if (lost.length) says.push(`Not on any output: ${lost.join(', ')}.`);
    const hint = $('out-hint');
    hint.textContent = says.join(' ');
    hint.hidden = !says.length;

    const devHint = $('out-device-hint');
    devHint.hidden = voice.canChooseDevice() && deviceFound;
    const chosen = O.deviceName || 'The chosen device';
    /* Chosen but not in the list: named plainly while it is playing anyway,
       and with the reason beside it while it is not. */
    const keep = $('outDevice').querySelector('option[data-unlisted]');
    if (keep) {
        keep.textContent = deviceFound ? chosen
            : `${chosen} (${named ? 'not connected' : 'not listed'})`;
    }
    devHint.textContent = !voice.canChooseDevice()
        ? 'This browser plays through the system output: choose the interface in System Settings › Sound, or open Models in Chrome to choose it here.'
        : named
            ? `${chosen} is not connected, so the system output is playing.`
            : `${chosen} is not listed until Show All Devices is pressed, so the system output is playing.`;
}

/* ---------------------------------------------------------------------
 *  The device
 * ------------------------------------------------------------------ */

/**
 * Fill the device list. A browser that has not been allowed an input lists
 * its outputs without names — or not at all — so the button that asks for
 * them is shown only then.
 */
async function listDevices() {
    const sel = $('outDevice');
    if (!voice.canChooseDevice() || !navigator.mediaDevices?.enumerateDevices) {
        sel.disabled = true;
        return;
    }
    let outs = [];
    try {
        outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) =>
            d.kind === 'audiooutput' && d.deviceId
            && d.deviceId !== 'default' && d.deviceId !== 'communications');
    } catch (e) {}
    named = outs.length > 0 && outs.every((d) => d.label);
    $('out-find-row').hidden = named;

    sel.replaceChildren(new Option('System Output', ''));
    outs.forEach((d, i) => sel.add(new Option(d.label || `Output ${i + 1}`, d.deviceId)));
    /* Chosen and not plugged in: still the choice, said as such, so plugging
       it back in picks up where it was rather than starting from the Mac. */
    if (O.device && !outs.some((d) => d.deviceId === O.device)) {
        const keep = new Option('', O.device);
        keep.dataset.unlisted = '';
        sel.add(keep);
    }
    sel.value = O.device;
    render();
}

/** Open the chosen device, or fall back to the system output if it is not there. */
async function useDevice() {
    try {
        channels = await voice.setDevice(O.device);
        deviceFound = true;
    } catch (e) {
        deviceFound = false;
        try { channels = await voice.setDevice(''); } catch (e2) { channels = voice.deviceChannels(); }
    }
    apply();
    render();
}

/* ---------------------------------------------------------------------
 *  The controls
 * ------------------------------------------------------------------ */

export function setupOutputs() {
    channels = voice.deviceChannels();

    $('out-layout').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        O.layout = b.dataset.v;
        save(); apply(); render();
    });

    /* A key turns that part on or off for that output. Several may be lit in
       a row, and one part may be lit in several rows. */
    $('out-rows').addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        O.routes[appMode][+b.dataset.row] ^= 1 << +b.dataset.id;
        save(); apply(); render();
    });

    /* Every silent output gets a part, by repeating the rows above it in
       order: two parts on four outputs come out S T S T, so each stereo pair
       carries the whole dyad. A row whose source is silent too gets the part
       it would have had in One Each. */
    $('out-double').addEventListener('click', () => {
        const parts = PARTS[appMode];
        const route = O.routes[appMode];
        const k = parts.length;
        for (let i = 0; i < rowCount(); i++) {
            if (route[i]) continue;
            const from = i % k;
            route[i] = (from !== i && route[from]) || (1 << parts[from][1]);
        }
        save(); apply(); render();
    });

    $('out-reset').addEventListener('click', () => {
        O.routes[appMode] = oneEach(appMode);
        save(); apply(); render();
    });

    const sel = $('outDevice');
    sel.addEventListener('change', () => {
        O.device = sel.value;
        O.deviceName = O.device ? sel.selectedOptions[0]?.textContent.replace(/ \(not (connected|listed)\)$/, '') : '';
        save();
        useDevice();
    });

    $('out-find').addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            for (const t of stream.getTracks()) t.stop();
        } catch (e) {}
        await listDevices();
        if (O.device) await useDevice();
    });

    /* Plugged in or pulled out: the list changes, and so may the channel count
       — of the chosen device coming back, or of the system output when the
       Mac switches to whatever was just connected. */
    navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
        await listDevices();
        await useDevice();
    });

    onModeApplied(() => { apply(); render(); });

    apply();
    render();
    listDevices().then(() => (O.device ? useDevice() : null));
}
