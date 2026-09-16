/* =====================================================================
 *  DYADS — what the mode is currently set to
 * =====================================================================
 *
 * The triangle keeps its settings in triad-state.js and the tetrahedron keeps
 * its in globals.js, for the reason the three have separate drawers: a control
 * that only exists in one mode has no business being read in another, and a
 * single store would make it impossible to tell which those are.
 *
 * What is NOT here is anything genuinely shared — the limit, the equave, the
 * complexity measure, the colormap, the synth, the notation. Those are read
 * from the same inputs the other two modes read; see read-panel.js.
 * ------------------------------------------------------------------ */

/**
 * Which measure the plot is a picture of.
 *
 * Four kinds of answer to one question, which is the point of the mode:
 *
 *   discrete WHICHEVER OF THE SIX the Complexity drawer is set to — Tenney,
 *            Weil, Wilson, Euler, Benedetti, Arithmetic. These are functions
 *            of a ratio's two numbers, so they have a value AT every just
 *            interval and none at all between them: no curve, only the height
 *            of the lattice itself.
 *   he       HARMONIC ENTROPY. How many simple readings of the interval the
 *            ear has to choose between. Probabilistic, and knows nothing
 *            about timbre.
 *   sethares SENSORY DISSONANCE. Partial against partial, from the spectrum
 *            of whatever wave is loaded in the Play drawer. Physical, and
 *            knows nothing about arithmetic.
 *   tenney   THE TENNEY NORM, MADE CONTINUOUS. log2(pq) at every ratio, with
 *            a parabola let down from each one so the space between them has
 *            a value too. Arithmetic, and knows nothing about ears.
 *
 * Nine measures between them, and they disagree. The Ratings overlay is what
 * lets you see which of them is right about a listener.
 */
export let dyadModel = 'he'; // 'discrete' | 'he' | 'sethares' | 'tenney'
export function setDyadModel(v) { dyadModel = v; }

/* ---- how the curve is drawn ----
   Fill and Line are independent rather than a choice of one, drawn with the
   same flagSeg the other modes use: the curve can be shaded under, stroked,
   both, or neither with only the lattice left. */
export let dyadFill = false;
export let dyadLine = true;
export function setDyadFill(v) { dyadFill = v; }
export function setDyadLine(v) { dyadLine = v; }

/**
 * How thick the curve is drawn, in pixels.
 *
 * The one setting here that is purely a matter of taste, and it earns its
 * place for that reason: at a hair's width the curve is a reading, and at six
 * pixels it is a drawing. Neither is more correct and the plot is used for
 * both.
 */
export let dyadLineWidth = 4.3;
export function setDyadLineWidth(v) { dyadLineWidth = v; }

/**
 * How much of the pane's height the measure is allowed to use, 0 to 1.
 *
 * Scaled about the MIDDLE rather than about the floor, so turning it down
 * settles the curve toward a straight line across the centre of the page
 * instead of squashing it into the bottom. At 1 the measure spans the whole
 * box, which is what it did before there was a control for it.
 *
 * Everything vertical goes through it together — the curve, the lattice stems
 * and the floor they stand on, the axis marks — so a low relief is a smaller
 * picture of the same plot rather than a curve floating loose over furniture
 * drawn at full size.
 */
export let dyadRelief = 0.5;
export function setDyadRelief(v) { dyadRelief = v; }

/**
 * Whether the plot has any furniture at all.
 *
 * Off, the ruler, the gridlines, the tick labels, the axis title and the frame
 * all go, the margins they were being kept for go with them, and what is left
 * is the measure drawn across the pane — which is the picture worth looking at
 * once you already know what the axes are. The cursor loses its crosshair and
 * its readout to match: a dot on a line, and nothing else on screen.
 */
export let dyadGrid = false;
export function setDyadGrid(v) { dyadGrid = v; }

/* ---- the JI dyads themselves ----
   Two questions, so two switches: whether the lattice is marked at all, and
   whether each mark says which interval it is. */
export let dyadDots = false;
export let dyadLabels = false;
export function setDyadDots(v) { dyadDots = v; }
export function setDyadLabels(v) { dyadLabels = v; }

/**
 * Land the cursor on the nearest just dyad within this many pixels, or never
 * if 0.
 *
 * Without it the marks are decoration: a pixel is a cent or two and the hand
 * is not that steady, so 3/2 is visible and not reliably touchable. With it, a
 * drag glides freely along the curve and clicks into the lattice as it passes.
 */
export let dyadSnap = 0;
export function setDyadSnap(v) { dyadSnap = v; }

/**
 * How long a voice takes to reach the pitch under the pointer, in seconds.
 *
 * Its own setting rather than the triangle's, because it is its own gesture:
 * two voices moving in contrary motion about a pivot is a different thing to
 * follow than three, and the useful amount of smoothing is not the same.
 */
export let dyadGlide = 0.045;
export function setDyadGlide(v) { dyadGlide = v; }

/** Which of the two voices is held while the other moves. 0 = lower. */
export let dyadPivot = 0;
export function setDyadPivot(v) { dyadPivot = v; }

/**
 * How many equaves wide the axis is.
 *
 * The equave itself is shared with the other two modes and is not this mode's
 * to change — but a dyad is the one chord that is perfectly readable beyond
 * one, and the rating data runs to 4/1. So the SPAN is the dyad's own control:
 * it widens the axis without touching the set the other two modes are built
 * from. At 2 the whole of the published data is on screen.
 */
export let dyadSpan = 2;
export function setDyadSpan(v) { dyadSpan = v; }

/* ---- model parameters ----
   Spread, order and depth are asked in the units the models are stated in, and
   the resolution is shared by all three so the curves are comparable. The
   entropy's are the wiki's: s = 17 ¢ (1 %), order 4, and the Tenney series
   to n·d ≤ 10 000 — root 100 — which is the wiki's own worked example and
   HE-JS's default. See heParams in triad-state.js for what each is. */
export const dheParams = {
    resolution: 1600, root: 100, series: 'tenney', spread: 17, alpha: 4, kernel: 'gaussian',
};
export const dsmParams = { resolution: 1600, partials: 12, ramp: 1 };
export const dtnParams = { resolution: 1600, softness: 20, depth: 50 };

/** Every model's resolution at once — the one slider that sets all three. */
export function setDyadResolution(v) {
    dheParams.resolution = v; dsmParams.resolution = v; dtnParams.resolution = v;
}

/**
 * Where the pointer is, as the interval in cents.
 *
 * One number, which is the whole difference between this mode and the
 * triangle: a dyad has one degree of freedom, so the picture is a curve rather
 * than a surface and the cursor is a position along it.
 */
export const cursor = { c: 0, live: false };
export function setCursor(c) { cursor.c = c; }
export function setCursorLive(v) { cursor.live = v; }
