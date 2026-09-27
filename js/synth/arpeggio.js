/* =====================================================================
 *  ARPEGGIATE — when each voice of a chord comes in
 * =====================================================================
 *
 * A chord is struck all at once unless the Play drawer's Tracking says
 * otherwise. With Arpeggiate above zero the voices come in one after another,
 * that far apart, in the order the arpeggiato switch beside it names — from
 * the bottom up, from the top down, or shuffled afresh on every strike.
 *
 * All this decides is WHEN. The notes are still posted together and the
 * worklet times them (see voice.js noteOn), each with the whole envelope it
 * would have had struck together, and a voice that has not come in yet still
 * follows the pointer: it enters at the pitch under it on arrival, not at
 * the one it was struck on, so the hand can keep moving while the chord
 * rolls in.
 * ------------------------------------------------------------------ */

/**
 * Seconds after the strike at which each voice comes in.
 *
 * "Up" and "down" are by pitch rather than by voice number, so they mean
 * what they say whichever voice is held and however the chord is spelled.
 *
 * @param {number[]} freqs   the chord, one frequency per voice
 * @param {number}   spacing seconds from one onset to the next; 0 is a
 *                           block chord
 * @param {'up'|'down'|'random'} order
 * @returns {number[]} one delay per voice, in the voices' own order
 */
export function onsets(freqs, spacing, order) {
    const n = freqs.length;
    if (!(spacing > 0)) return new Array(n).fill(0);

    const seq = freqs.map((_, i) => i).sort((a, b) => freqs[a] - freqs[b]);
    if (order === 'down') seq.reverse();
    else if (order === 'random') {
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [seq[i], seq[j]] = [seq[j], seq[i]];
        }
    }

    const out = new Array(n);
    seq.forEach((voiceIndex, k) => { out[voiceIndex] = k * spacing; });
    return out;
}

/** How the Arpeggiate slider reads: 'off' at 0, where the chord is a block. */
export function arpLabel(ms) {
    if (!(ms > 0)) return 'off';
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}
