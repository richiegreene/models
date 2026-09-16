/* =====================================================================
 *  TRIADS — what the mode is currently set to
 * =====================================================================
 *
 * globals.js holds the tetrahedron's settings, dyad-state.js holds the plot's
 * and this holds the triangle's, for the same reason the three have separate
 * drawers: a control that only exists in one mode has no business being read
 * in another, and a single store would make it impossible to tell which those
 * are.
 *
 * The one thing that is NOT here is anything the three modes genuinely share —
 * the limit, the equave, the complexity measure, the colormap, the synth, the
 * notation. Those stay where they were, and Triads reads them from the same
 * inputs the other two do, so a 13-limit means one thing in this app; see
 * read-panel.js. Which mode you are in is not here either — that belongs to
 * none of the three, and lives in app-mode.js.
 * ------------------------------------------------------------------ */

/**
 * Which of the three panes are up.
 *
 * 'both' is not a compromise between the other two — it is the reason the
 * setting exists. A contour map says exactly where a concordance is and says
 * nothing about how deep it is; a lifted surface says how deep and blurs
 * where. Side by side, linked to one cursor, each answers the other's
 * question about the same chord.
 */
/* 'both' is the default: the flat pane and the lifted one are two readings of
   the same field, and the pair is what the mode is for. Opening on the
   topology alone made the 3D pane a thing you had to go and find, and the
   linked cursor — one position, shown in both — cannot say anything at all
   until both are up. Kept in step with the lit chip in `#triad-view-seg`;
   the markup is the single statement of which one that is. */
export let triadView = 'both'; // 'topo' | '3d' | 'both'
export function setTriadView(v) { triadView = v; }

/** Which field is under the triangle. 'blank' is the JI dots on their own. */
export let triadModel = 'he'; // 'blank' | 'he' | 'sethares'
export function setTriadModel(v) { triadModel = v; }

/* ---- how the field is drawn ----
   Fill and Lines are independent rather than a choice of one, drawn with the
   same toggleSeg the Display drawer uses for Size and Color: a surface can be
   shaded, contoured, both, or neither with only the dots left. */
export let triadFill = true;
export let triadLines = false;
export function setTriadFill(v) { triadFill = v; }
export function setTriadLines(v) { triadLines = v; }

export let triadContours = 24;
export function setTriadContours(v) { triadContours = v; }

/* How thick a contour line is drawn, in pixels — the same control Dyads has
   over its curve, and for the same reason: at a hair's width the lines are a
   reading of the field, and at six pixels they are a drawing of it. Pixels
   rather than world units so the two panes agree: the flat pane strokes them
   on a canvas and the lifted one draws them as screen-space ribbons, and a
   line that thinned as the surface receded would be a different control in
   each. */
export let triadLineWidth = 1.5;
export function setTriadLineWidth(v) { triadLineWidth = v; }

/**
 * How wet the surface is, 0 to 1.
 *
 * One control over two situations — see `lighting` in color-mapping.js. It
 * starts at nothing, because the ordinary ramps must look exactly as they
 * always did until it is asked for: their colours already carry the values,
 * and shading them would corrupt the reading, so gloss lays a highlight over
 * the top and touches nothing underneath.
 *
 * The constant layouts use the full range: at 0 they are matte, shaded by the
 * light but with no highlight, and at 1 they are a mirror.
 */
export let triadGloss = 0.3;
export function setTriadGloss(v) { triadGloss = v; }

/** How far the 3D pane lifts the field, as a fraction of the triangle's side. */
export let triadRelief = 0.15;
export function setTriadRelief(v) { triadRelief = v; }

/* ---- the JI triads themselves ----
   Isoharmonics draws dots and labels as two independent switches, and they
   are two questions: whether the lattice is marked at all, and whether each
   mark says which chord it is. */
export let triadDots = false;
export let triadLabels = false;
export function setTriadDots(v) { triadDots = v; }
export function setTriadLabels(v) { triadLabels = v; }

/**
 * Land the cursor on the nearest JI triad when it comes within this many
 * pixels of one, or never if 0.
 *
 * Without it the dots are decoration: you can see 4:5:6 and you cannot
 * reliably touch it, because one pixel is a couple of cents and the pointer
 * is not that steady. With it, dragging across the triangle glides freely
 * through the field and clicks into the lattice as it passes, which is the
 * gesture the mode is for.
 */
export let triadSnap = 0;
export function setTriadSnap(v) { triadSnap = v; }

/**
 * How long a voice takes to reach the pitch under the pointer, in seconds.
 *
 * This is the whole difference from the app it comes from. Isoharmonics
 * rebuilds a looping buffer on every pointer move and crossfades to it, so a
 * drag is a stream of re-attacks with half a second of overlap between them;
 * here the three voices are struck once, on the way down, and every move
 * after that is a glide message to voices that never stopped. At 0 they
 * track the pointer exactly; a little smoothing takes the stair-stepping off
 * a fast drag without the pitch lagging audibly behind the hand.
 */
export let triadGlide = 0.045;
export function setTriadGlide(v) { triadGlide = v; }

/** Which of the three voices is held while the other two move. 0 = lowest. */
export let triadPivot = 0;
export function setTriadPivot(v) { triadPivot = v; }

/* ---- model parameters ----
   The entropy's are the wiki's own — see he-python.js — said in the units the
   panel asks for: `spread` is s in cents (17 ≈ 1 %), `alpha` the Rényi order
   (4 to open on, the same in all three modes — 1 is Shannon, the original,
   and 7 is Sintel's), `series` which height bounds the basis set
   and so which weighting it gets, `root` the bound as the slider states it
   (Tenney: a·b·c ≤ root³ — 300 is Sintel's 27 000 000), and `kernel` the
   spreading function. The three modes keep one set each rather than sharing,
   because the cost of a resolution is not the same in one dimension as in
   three — but the fields are the same fields, and the same words. Resolution
   is the grid both models are sampled onto; it is shared because the two are
   meant to be comparable. */
export const heParams = {
    resolution: 420, root: 300, series: 'tenney', spread: 17, alpha: 4, kernel: 'gaussian',
};
export const smParams = { resolution: 420, partials: 12, step: 0.02, spread: 20, ramp: 1 };

/**
 * Where the pointer is, as the two intervals of the triad in cents.
 *
 * One cursor for all three panes: this is what "linked" means. The 2D pane
 * writes it on a drag and the 3D pane writes it on a drag, and both of them
 * draw their marker from it, so the two views cannot come to disagree about
 * which chord is sounding.
 */
export const cursor = { c1: 0, c2: 0, live: false };
export function setCursor(c1, c2) { cursor.c1 = c1; cursor.c2 = c2; }
export function setCursorLive(v) { cursor.live = v; }
