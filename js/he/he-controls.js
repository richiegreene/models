/* =====================================================================
 *  HARMONIC ENTROPY — its controls, built once for the three modes
 * =====================================================================
 *
 * The line, the triangle and the tetrahedron take the same model with the
 * same five settings, so the block of controls is built by one function
 * rather than written three times in the markup — three copies could not be
 * kept saying the same things with the same tooltips, and the whole point of
 * the parameters is that they mean one thing wherever they are read.
 *
 * The five, in the wiki's own letters (https://en.xen.wiki/w/Harmonic_entropy):
 *
 *   Spread  s   the standard deviation of the spreading function, in cents,
 *               with the percentage of frequency it comes to beside it —
 *               17 ¢ is the canonical one percent.
 *   Order   a   the Rényi order. 1 is Shannon, Erlich's original; 2 is
 *               collision entropy; large a approaches min-entropy, which
 *               asks only how probable the single most likely reading is.
 *   Series      which height the basis set is bounded by, and so which
 *               weighting it gets: Tenney (n·d ≤ N, weight 1/√nd) or Weil
 *               (max(n,d) ≤ N, weight 1/max) — HE-JS's Tenney and Farey.
 *   Height  N   the bound, set by its ROOT so that one slider means one
 *               depth of series in every mode: root 100 is n·d ≤ 10 000 for
 *               a dyad and a·b·c ≤ 1 000 000 for a triad. The readout says
 *               the bound itself.
 *   Kernel      the spreading function's shape: Gaussian, or the heavier-
 *               tailed Laplace ("Vos") curve, both scaled to the same s.
 *
 * Each mode keeps its own copy of the numbers, in its own state module,
 * because a resolution costs differently in one dimension than in three and
 * a series that is instant on a line is a second on a volume. But the words,
 * the ranges and the readouts are these.
 * ------------------------------------------------------------------ */

const TIP = {
    spread: 'How wide the ear\'s uncertainty about a pitch is taken to be — the standard deviation s of the spreading function, in cents, with the percentage of frequency it amounts to. 17 ¢ is the canonical one percent. Narrow gives sharp isolated wells; wide merges neighbours into broad regions of concordance.',
    alpha: 'The order a of the Rényi entropy. 1 is Shannon — Erlich\'s original harmonic entropy, and the one that needs the least of the grid. 2 is collision entropy. Higher orders weigh the single most likely reading more and more heavily, toward min-entropy, and effectively narrow the kernel by √a.',
    tenney: 'Every chord with a·b·c… no more than N, weighted by 1/√(a·b·c…) — the width Erlich found the mediant-to-mediant domains to have under a Tenney-height bound. The wiki\'s and HE-JS\'s default series.',
    weil: 'Every chord whose largest number is no more than N — the Farey series and its reciprocals — weighted by 1/max(a, b, c…), the domain width under a Weil-height bound. HE-JS\'s "Farey" series.',
    root: 'How far up the harmonic series the chords being weighed are drawn from. Set by the root of the bound, so that one number is one depth of series whether it is read over one interval or three; the readout says the bound itself. Deeper is slower, and past a point changes little.',
    gaussian: 'The normal distribution: the usual spreading function.',
    laplace: 'The Laplace distribution — the "Vos function" in Erlich\'s writing — with the same standard deviation but heavier tails, so a reading further from the pitch still gets some probability.',
};

/** The percent-of-frequency a spread in cents comes to, as the wiki states s. */
const pct = (cents) => (100 * (Math.pow(2, cents / 1200) - 1)).toFixed(2);

/** The bound, said as a number that can be read. */
function sayBound(N) {
    if (N < 1e6) return N.toLocaleString('en-US').replace(/,/g, ' ');
    const exp = Math.floor(Math.log10(N));
    const mant = N / Math.pow(10, exp);
    const sup = String(exp).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    return `${mant.toFixed(1)}×10${sup}`;
}

/** What the height readout says, for this many voices under this series. */
function sayHeight(root, voices, series) {
    if (series === 'weil') return `max ≤ ${root}`;
    const letters = voices === 2 ? 'n·d' : voices === 3 ? 'a·b·c' : 'a·b·c·d';
    return `${letters} ≤ ${sayBound(Math.pow(root, voices))}`;
}

/** What the order readout says: the number, and its name where it has one. */
function sayOrder(a) {
    const v = a.toFixed(1);
    if (Math.abs(a - 1) < 1e-9) return `${v} · Shannon`;
    if (Math.abs(a - 2) < 1e-9) return `${v} · collision`;
    return v;
}

/**
 * Build the block into `host` and wire it to `params`.
 *
 * @param {HTMLElement} host   an empty element in the mode's Model fieldset
 * @param {object} o
 * @param {string} o.prefix    unique id prefix for this mode's copy
 * @param {number} o.voices    2, 3 or 4 — for the height readout
 * @param {object} o.params    the mode's state object: spread, alpha, series, root, kernel
 * @param {{min:number,max:number,step:number}} o.root  the root slider's range
 * @param {() => void} o.onChange  what to do after any of them moves
 */
export function buildHeControls(host, { prefix, voices, params, root, onChange }) {
    if (!host) return;
    const id = (s) => `${prefix}-${s}`;
    host.innerHTML = `
      <div class="pressrow">
        <label for="${id('spread')}">Spread <i>s</i></label>
        <span class="pressval" id="${id('spread-v')}"></span>
      </div>
      <input type="range" id="${id('spread')}" min="4" max="80" step="1" value="${params.spread}">
      <div class="pressrow">
        <label for="${id('alpha')}">Order <i>a</i></label>
        <span class="pressval" id="${id('alpha-v')}"></span>
      </div>
      <input type="range" id="${id('alpha')}" min="1" max="12" step="0.1" value="${params.alpha}">
      <div class="he-row">
        <div class="he-col">
          <div class="tune-h">Series</div>
          <div class="seg" id="${id('series')}">
            <button data-v="tenney">Tenney</button>
            <button data-v="weil">Weil</button>
          </div>
        </div>
        <div class="he-col">
          <div class="tune-h">Kernel</div>
          <div class="seg" id="${id('kernel')}">
            <button data-v="gaussian">Gauss</button>
            <button data-v="laplace">Laplace</button>
          </div>
        </div>
      </div>
      <div class="pressrow">
        <label for="${id('root')}">Height <i>N</i></label>
        <span class="pressval" id="${id('root-v')}"></span>
      </div>
      <input type="range" id="${id('root')}" min="${root.min}" max="${root.max}" step="${root.step}" value="${params.root}">
    `;
    const $ = (s) => host.querySelector('#' + id(s));

    $('spread').title = TIP.spread;
    $('alpha').title = TIP.alpha;
    $('root').title = TIP.root;
    $('series').querySelector('[data-v="tenney"]').title = TIP.tenney;
    $('series').querySelector('[data-v="weil"]').title = TIP.weil;
    $('kernel').querySelector('[data-v="gaussian"]').title = TIP.gaussian;
    $('kernel').querySelector('[data-v="laplace"]').title = TIP.laplace;

    const showSpread = () => { $('spread-v').textContent = `${params.spread} ¢ · ${pct(params.spread)}%`; };
    const showAlpha = () => { $('alpha-v').textContent = sayOrder(Number(params.alpha)); };
    const showRoot = () => { $('root-v').textContent = sayHeight(params.root, voices, params.series); };
    const light = (segId, value) => {
        for (const b of $(segId).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === value);
    };

    $('spread').addEventListener('input', () => { params.spread = parseFloat($('spread').value); showSpread(); onChange(); });
    $('alpha').addEventListener('input', () => { params.alpha = parseFloat($('alpha').value); showAlpha(); onChange(); });
    $('root').addEventListener('input', () => { params.root = parseInt($('root').value); showRoot(); onChange(); });
    $('series').addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        params.series = btn.dataset.v;
        light('series', params.series);
        showRoot();
        onChange();
    });
    $('kernel').addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        params.kernel = btn.dataset.v;
        light('kernel', params.kernel);
        onChange();
    });

    showSpread(); showAlpha(); showRoot();
    light('series', params.series);
    light('kernel', params.kernel);
}
