/* =====================================================================
 *  THE SHARED PANEL, READ ONCE
 * =====================================================================
 *
 * The limit, the equave, the complexity measure and the two display channels
 * are not settings of any one mode: a 13-limit means the same thing whether it
 * is being read over one interval, two, or three, and the whole point of
 * keeping them in the same fieldsets is that the three pictures are pictures of
 * the same set. So the reader lives here, where none of the three owns it,
 * rather than in whichever mode happened to need it first.
 *
 * Read rather than mirrored: there is no second copy of these values anywhere,
 * so there is nothing to fall out of step with the inputs.
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

/**
 * Everything in the Complexity and Display drawers that decides which chords
 * exist and how they are drawn.
 *
 * The limit field carries a second setting inside it: a slash introduces a
 * virtual-fundamental filter, either as a dotted list (13/1.3.5) or as a range
 * (13/1...8). Parsed here so that every mode understands the same shorthand.
 */
export function readPanel() {
    const raw = $('limitValue').value;
    let limitValue = raw;
    let virtualFundamentalFilter = null;

    if (raw.includes('/')) {
        const [head, tail] = raw.split('/');
        limitValue = head.trim();
        const filter = tail.trim();
        virtualFundamentalFilter = [];
        if (filter.includes('...')) {
            const [a, b] = filter.split('...');
            const start = parseInt(a), end = parseInt(b);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) virtualFundamentalFilter.push(i);
            }
        } else {
            virtualFundamentalFilter = filter.split('.')
                .map((n) => parseInt(n.trim())).filter((n) => !isNaN(n));
        }
    }

    return {
        limitType: $('limitType').value,
        limitValue,
        maxExponent: $('maxExponent').value,
        virtualFundamentalFilter,
        equaveRatio: parseFloat($('equaveRatio').value) || 2,
        complexityMethod: $('complexityMethod').value,
        hideUnisonVoices: $('hideUnisonVoices').checked,
        omitOctaves: $('omitOctaves').checked,
        baseSize: parseFloat($('baseSize').value),
        scalingFactor: parseFloat($('scalingFactor').value),
        enableSize: $('enableSize').checked,
        enableColor: $('enableColor').checked,
        /* 0..1: how faint the lattice's dots and labels are drawn. */
        latticeOpacity: Math.min(1, Math.max(0, (parseFloat($('latticeOpacity').value) || 0) / 100)),
    };
}
