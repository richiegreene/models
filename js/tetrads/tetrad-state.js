/* =====================================================================
 *  TETRADS — what the field is currently set to
 * =====================================================================
 *
 * globals.js still holds what the tetrahedron has always held — the sprites'
 * settings, the pivot, the slide — and this holds only what the entropy field
 * adds: which model is under the points, its parameters, and how the volume
 * is cut and shown. Same split the other two modes have, for the same reason:
 * a control that only exists here has no business being read anywhere else.
 * ------------------------------------------------------------------ */

/** What the tetrahedron is filled with. 'blank' is the points on their own;
 *  it opens on the field, which is what the mode is for. */
export let tetradModel = 'he'; // 'blank' | 'he'
export function setTetradModel(v) { tetradModel = v; }

/* ---- the model's parameters ----
   The same six words the line and the triangle use, meaning the same things
   — see heParams in triad-state.js — with the numbers a volume can afford.
   Resolution is cells per axis: 128 is a 9.4 ¢ cell over an octave, which
   resolves the kernel a 17 ¢ spread at order 4 is effectively taken with
   (s/√a = 8.5 ¢ — a higher order narrows it by √a, and the foot says when
   the cell is too coarse for it) and computes in a few seconds; `root` 60
   is a·b·c·d ≤ 60⁴, some 230 000 tetrads. Order 4 to open on, the same in
   all three modes. */
export const theParams = {
    resolution: 128, root: 60, series: 'tenney', spread: 17, alpha: 4, kernel: 'gaussian',
};

/* ---- how the volume is shown ----
   Two independent switches, like the triangle's Fill and Lines: the CUT is
   an opaque triangle through the field, the VOLUME is the whole field as a
   translucent body. Either alone, or both — a bright section through a
   ghost, which is the tomograph's own picture. It opens on the body alone;
   the cut is something to reach for. */
export let tetradSlice = false;
export let tetradVolume = true;
export function setTetradSlice(v) { tetradSlice = v; }
export function setTetradVolume(v) { tetradVolume = v; }

/** Which interval the cut holds constant — see sliceTriangle in tetrad-geometry.js. */
export let tetradAxis = 'span'; // 'span' | 'lower' | 'middle' | 'upper'
export function setTetradAxis(v) { tetradAxis = v; }

/** Where the cut is, as a fraction of the equave, 0 to 1. */
export let tetradPosition = 0.5;
export function setTetradPosition(v) { tetradPosition = Math.min(1, Math.max(0, v)); }

/** Whether the cut is being swept back and forth on its own. */
export let tetradSweep = false;
export function setTetradSweep(v) { tetradSweep = v; }

/**
 * How opaque the body is, 0 to 1.
 *
 * The volume is drawn by marching a ray through it and letting each step
 * deposit a little colour; this is how much. Low is a haze that only the
 * deepest wells show through; high is a solid you have to cut to see into.
 */
export let tetradDensity = 0.6;
export function setTetradDensity(v) { tetradDensity = v; }

/**
 * How sharply the wells stand out of the body, as an exponent on concordance.
 *
 * At 1 the opacity is the concordance itself and the whole tetrahedron is a
 * mist; at 4 only the most concordant few percent deposit anything and the
 * volume resolves into a constellation of the simplest chords.
 */
export let tetradFocus = 3;
export function setTetradFocus(v) { tetradFocus = v; }

/**
 * Land the pointer on the nearest just tetrad within this many cents, or
 * never if 0 — the triangle's Snap, measured in cents because a dot's
 * distance on screen depends on how the shape happens to be turned.
 */
export let tetradSnap = 0;
export function setTetradSnap(v) { tetradSnap = v; }

/**
 * How long a voice takes to reach the pitch under the pointer while a cut is
 * being played, in seconds — the triangle's Tracking, over four voices. The
 * Play drawer's Portamento is a different thing: how the four voices travel
 * between two POINTS. This is how they follow a hand across a surface.
 */
export let tetradGlide = 0.045;
export function setTetradGlide(v) { tetradGlide = v; }

/**
 * Where the pointer is on the cut, as the three intervals in cents.
 *
 * One cursor: the cut writes it on a drag, the bead is drawn from it, and
 * the readout names it — so the chord you see marked is the chord sounding.
 */
export const cursor = { c1: 0, c2: 0, c3: 0, live: false };
export function setCursor(c1, c2, c3) { cursor.c1 = c1; cursor.c2 = c2; cursor.c3 = c3; }
export function setCursorLive(v) { cursor.live = v; }
