/* =====================================================================
 *  TRIADS — the lifted pane
 * =====================================================================
 *
 * The same field as a surface: height is the value, so a concordance is a
 * summit and the contour map next to it is that summit seen from above.
 *
 * ITS OWN SCENE.  The tetrahedron's renderer is left completely alone. Sharing
 * it would mean sharing a camera whose framing is wrong for a triangle, an
 * OrbitControls the tetrahedron's Play mode switches off, and a key handler
 * that turns the whole scene — and in "Both" the two would have to be on
 * screen at the same time regardless. A second context is the cheap answer.
 *
 * PICKING IS ARITHMETIC, NOT SEARCH.  Isoharmonics finds the chord under the
 * pointer by projecting every hundredth mesh vertex to the screen and taking
 * the nearest, which is slow, misses by up to a hundred vertices, and needs
 * PyOpenGL for the projection. The surface here is a height field over a known
 * triangle, so the ray is intersected with the surface directly by three.js
 * and the hit point IS the chord: its x and y are the two intervals, exactly,
 * with no search and no tolerance.
 * ------------------------------------------------------------------ */

import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.126.0/examples/jsm/controls/OrbitControls.js';
/* FAT LINES, because WebGL has no thick ones.
   `LineBasicMaterial.linewidth` is silently ignored on every desktop GL
   driver — the spec allows a driver to support only a single pixel, and they
   all do exactly that — so a thickness control over ordinary LineSegments
   would move a number and change nothing on screen. These three build each
   segment as a screen-facing quad instead, which is what makes the Line size
   slider mean the same thing in the lifted pane as it does in the flat one.
   Same version and same CDN as the controls above. */
import { LineSegments2 } from 'https://unpkg.com/three@0.126.0/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'https://unpkg.com/three@0.126.0/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'https://unpkg.com/three@0.126.0/examples/jsm/lines/LineMaterial.js';

import {
    centsToShape, shapeToCents, clampCents, equaveCents,
    sampleField, normalise, SQRT3_2,
} from './triad-geometry.js';
import {
    triadRelief, triadDots, triadLabels, triadSnap, triadFill, triadLines,
    triadContours, triadLineWidth, triadGloss, cursor,
} from './triad-state.js';
import { currentTriads, currentField, complexityRange } from './triad-surface.js';
import { currentLayoutMode } from '../globals.js';
import { colormapFn, colormap, colormapMaterial, onLight, groundColor, contourSegments } from './triad-2d.js';
import { lighting, layoutSignature } from '../calculations/color-mapping.js';
import { rotationSpeed, autoRotate, autoRotateDir, keyState } from '../globals.js';
import {
    halftoneOn, HALFTONE_GLSL, halftoneUniforms, syncHalftoneUniforms, groundHex, inkHex,
} from '../calculations/halftone.js';

/* ---- the surface in one ink ----
   Two lays of the one screen, chosen by a uniform — see halftone.js. On the
   GLASS the lattice is laid in screen space, gl_FragCoord, so the dots are
   the size the panel says wherever the surface is and however it is turned,
   exactly as they are on the flat pane. On the SHAPE it is laid over the
   surface's plan — the scene's x and z, which are the two intervals scaled —
   and lifted onto the relief with it, so it is the flat pane's own screen
   seen in perspective: square from above, foreshortened on the slopes, and
   turning with the surface rather than showing through it. The value comes
   up from the vertices either way. No light: a screened surface is read by
   its silhouette and its contours, the way an engraving is. */
const HALFTONE_VERT = /* glsl */`
attribute float value;
varying float vValue;
varying vec2 vPlan;
void main() {
    vValue = value;
    vPlan = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const HALFTONE_FRAG = HALFTONE_GLSL + /* glsl */`
uniform int uHtMethod;
uniform int uHtShape;
uniform float uHtCell;
uniform float uHtCellWorld;
uniform vec3 uHtInk;
uniform vec3 uHtGround;
varying float vValue;
varying vec2 vPlan;
void main() {
    float c = uHtShape == 1
        ? halftoneSurface(vPlan, vValue, uHtCellWorld, uHtMethod)
        : halftoneCoverage(gl_FragCoord.xy, vValue, uHtCell, uHtMethod);
    gl_FragColor = vec4(mix(uHtGround, uHtInk, c), 1.0);
}`;

/** The triangle is drawn one unit on a side, centred on the origin. */
const SIDE = 3.0;

let host = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let onGesture = null;

/* Everything that belongs to the triangle lives under one group, and it is
   that group the arrow keys turn — the way the tetrahedron turns its whole
   scene. Rotating the parts individually would work until the cursor bead had
   to be placed on a surface that had been turned out from under it. */
let world = null;
let surface = null;      // the mesh, or the flat plate when there is no field
let lattice = null;      // the JI dots
let labels = null;       // the JI labels, as sprites
let lines = null;        // the contour lines, laid on the surface
let marker = null;       // the cursor
let keyLight = null;
let fillLight = null;

let dragging = false;
let opts = { equaveRatio: 2, baseSize: 1, scalingFactor: 2, enableSize: true, enableColor: true };

/** Shape coordinates (and a height) → the scene's own space. */
function place(gx, gy, z = 0) {
    return new THREE.Vector3(
        (gx - 0.5) * SIDE,
        z,
        -(gy * SQRT3_2 - SQRT3_2 / 2) * SIDE,
    );
}

/* ---------------------------------------------------------------------
 *  The view the pane opens on
 *
 *  Looking ALONG one of the triangle's own edges, from slightly above.
 *
 *  The default used to be straight down the Z axis from a little way up
 *  — (0, 2.6, 4.2) — which puts the baseline across the bottom of the frame
 *  and the apex in the middle of it. That is the flat pane's composition
 *  rendered in perspective: symmetrical, square-on, and telling you nothing
 *  the topology pane was not already telling you better.
 *
 *  An edge-on view is the one a lifted surface is worth turning to. Put the
 *  camera's horizontal heading parallel to the base-right → apex edge and that
 *  edge recedes directly away from the eye, so it projects as a VERTICAL LINE
 *  down the right of the shape — a clean straight datum to read the relief
 *  against — while the third vertex swings out to the left and the whole
 *  triangle tilts away into the frame. Every ridge is now crossed at an angle
 *  instead of head-on, which is what makes a relief read as relief.
 *
 *  The heading is derived from the two vertices rather than written out as a
 *  vector, so it stays correct if the triangle is ever placed differently.
 *  The elevation is the one number here that is a matter of taste. It was
 *  30°, a comfortable iso; 45° looks down on the triangle enough to open its
 *  FACE toward the viewer — which is the thing being read, and at the shallower
 *  angle it was foreshortened to a band — while still leaving the peaks
 *  standing against the sky rather than being looked straight down on. It is a
 *  named constant because it is exactly the kind of thing that wants nudging
 *  by eye.
 * ------------------------------------------------------------------ */
const HOME_ELEVATION = 45 * Math.PI / 180;

/**
 * How far the opening view is turned back toward the viewer, off the edge.
 *
 * Dead edge-on is the cleanest statement of the idea — that edge projects to a
 * perfectly vertical line — but it is also the most foreshortened the triangle
 * can be, and it hides the face you are meant to be reading. Ten degrees off
 * opens the surface toward the viewer at almost no cost to the datum: the
 * right edge leans by a couple of percent of the pane's width rather than
 * standing exactly plumb, which reads as a a shape sitting naturally in space
 * rather than as a diagram that has slipped.
 *
 * NEGATIVE turns toward the front. The heading's azimuth is measured from the
 * +Z axis, which is where the baseline faces; the edge-on view sits at +30°,
 * and subtracting brings it back down toward face-on.
 */
const HOME_FACE_TURN = -10 * Math.PI / 180;

const HOME_DIR = (() => {
    /* The edge the view is built on: base-right to apex. */
    const b = place(1, 0), c = place(0.5, 1);
    const along = new THREE.Vector3().subVectors(c, b);
    along.y = 0;
    along.normalize();
    /* The camera looks ALONG that edge, so it stands at the other end of it —
       the heading is the edge reversed, laid back by the elevation — and is
       then turned back toward the viewer. Rotating about Y leaves the
       elevation alone and moves only the azimuth. */
    return new THREE.Vector3(
        -along.x * Math.cos(HOME_ELEVATION),
        Math.sin(HOME_ELEVATION),
        -along.z * Math.cos(HOME_ELEVATION),
    ).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME_FACE_TURN);
})();

/** And back — the inverse, which is the whole of picking. */
function unplace(p) {
    return {
        gx: p.x / SIDE + 0.5,
        gy: (-p.z / SIDE + SQRT3_2 / 2) / SQRT3_2,
    };
}

export function attach3D(el, gestureHandler) {
    host = el;
    onGesture = gestureHandler;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    world = new THREE.Group();
    scene.add(world);

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    /* Only a direction — frameCamera works out how far back it has to be once
       the pane has a size and the relief has a height. The 5 is arbitrary and
       is replaced on the first frame; what matters is the heading. */
    camera.position.copy(HOME_DIR).multiplyScalar(5);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    host.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    /* `start` fires on the gesture that begins an orbit, a pan or a wheel, and
       on nothing else — `change` would also fire for the app's own framing and
       for damping's own settling, which would latch the flag immediately. */
    controls.addEventListener('start', () => { userPlaced = true; });
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.minDistance = 1.2;
    controls.maxDistance = 24;

    /* A key from up and to the left — the direction every relief map is read
       by, and the same one the flat pane hillshades from, so the two panes are
       the same surface under the same lamp. A soft fill keeps the shadowed
       faces from going to black. Both hang off the CAMERA rather than the
       scene, so turning the shape moves the surface under a fixed light
       instead of carrying the light around with it: that is what makes the
       specular highlight travel across the peaks as it turns, which is the
       whole point of a material layout. */
    fillLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(fillLight);
    keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(-2.4, 3.4, 2.2);
    camera.add(keyLight);
    scene.add(camera);

    marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    marker.visible = false;
    world.add(marker);

    bindPointer();
    resize();

    return { draw, resize, rebuild, render, renderer: () => renderer };
}

/**
 * Whether the view on screen is the user's rather than the app's.
 *
 * Set by the controls' own `start`, which fires on the gesture that begins a
 * drag, a pan or a wheel — so it means "somebody has placed this camera",
 * never "something moved it". Cleared by fitView, which is the app saying it
 * is taking the framing back.
 */
let userPlaced = false;

export function resize() {
    if (!renderer || !host) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    /* A hidden pane measures zero. Framing against that would put the camera
       at an absurd distance and leave it there when the pane came back, so a
       measurement of nothing is not treated as a measurement. */
    if (host.clientWidth < 2 || host.clientHeight < 2) return;
    /* setSize's third argument is updateStyle, and it MUST stay on here.
       The buffer is sized in device pixels — w and h times the pixel ratio —
       and it is the CSS width and height three writes alongside it that say
       those pixels are to be shown across w by h of the page. Suppressed, the
       canvas lays itself out at its attribute size instead: on a 2x display
       that is a canvas twice the pane in each direction, anchored at the
       pane's top-left, so only its top-left quarter is visible and a picture
       correctly centred in the buffer appears magnified, off in the bottom
       right, and clipped. The other panes give their canvases width:100% in
       the stylesheet and never saw it; this one has no such rule. */
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    /* The fat lines size themselves in pixels, so they have to be told what a
       pixel is now worth. */
    if (lines && lines.material && lines.material.resolution) {
        lines.material.resolution.set(w, h);
    }
    /* A resize re-fits, but it re-fits AROUND the user rather than over them —
       see refitPreservingUser. The surface goes on filling the pane the way
       the flat one does, and an orbit, a pan or a zoom survives the side rail
       being opened, which it did not when this simply called frameCamera. */
    refitPreservingUser();
}

/**
 * Frame the surface, now — what the mode calls whenever the pane has just
 * become visible or has just been given something new to show.
 *
 * Deferred by a frame because the usual reason for asking is that the pane's
 * CSS has this instant changed: `display` has been set but the layout that
 * gives it a width has not been done yet, and a camera framed against the old
 * size is exactly the crop this is meant to prevent.
 */
export function fitView() {
    if (!renderer || !host) return;
    /* An explicit reframe: the app is taking the framing back, so whatever the
       user had placed is being replaced on purpose and the flag goes with it.
       Cleared BEFORE the deferred work so the resize inside it does not take
       the preserving branch. */
    userPlaced = false;
    requestAnimationFrame(() => {
        resize();
        frameCamera();
    });
}

/**
 * Where the camera would sit to hold the whole surface, centred, right now.
 *
 * WHAT IS BEING FRAMED.  The six corners of the triangular prism the surface
 * lives in — the three corners of the triangle, at the ground and at the top
 * of the relief. This used to be the eight corners of the surface's BOUNDING
 * BOX, which is a rectangular block half of which the triangle does not
 * occupy, so the frame was solved against a phantom that stuck out past the
 * shape on one side and the picture sat off-centre by the difference.
 *
 * HOW IT IS CENTRED: IN SCREEN SPACE, NOT IN CAMERA SPACE.  The obvious thing
 * is to measure the corners along the camera's own axes and aim at the middle
 * of what they span. That is an ORTHOGRAPHIC answer, and this is a perspective
 * camera: depth changes how far from the centre a point lands, so the near
 * corners throw out further than the far ones and the true middle of the
 * picture is not the middle of the span. Solving it that way left the surface
 * sitting 7% right of centre and low in the pane.
 *
 * So the corners are PROJECTED and the answer is iterated. Each pass puts the
 * camera where the current guess says, projects the six corners, and reads off
 * how far the picture's box is from the centre of the frame and how much of
 * the frame it fills; the target slides by the first and the distance scales
 * by the second. It converges in a handful of passes because each correction
 * is very nearly right, and it costs six projections a pass on a routine that
 * runs when the pane changes size — not per frame.
 *
 * A bounding sphere would be simpler and would waste most of the pane: a
 * triangle with a low relief is a wide flat thing, and the sphere that holds
 * it is mostly empty air above and below.
 *
 * The DIRECTION is read from the camera and never written, so a surface the
 * user has turned stays turned.
 */
/**
 * A thinned copy of what is actually being drawn, for the framing to aim at.
 *
 * The frame used to be solved against the triangular PRISM — the footprint
 * swept from the ground to the height of the tallest peak. The footprint is
 * exact, but the lid is not: it is a flat ceiling at peak height stretched
 * over the whole triangle, and almost all of it is empty air, because a peak
 * is a peak precisely by being somewhere rather than everywhere. Framing
 * against that reserved room at the top of the pane for nothing, and pushed
 * the picture down by a couple of percent.
 *
 * So the surface says where it really is — but not with every vertex, which
 * would be tens of thousands of points to settle a hull.
 *
 * WHICH POINTS ARE KEPT IS NOT A MATTER OF TASTE.  A plain stride is the
 * obvious thinning and it is wrong here: the points that decide the outline
 * are the ones on the edge of the mask, and a stride steps straight over most
 * of them. Framed against what was left, the picture came out believing it was
 * narrower than it is and overflowed the margin it was supposed to be sitting
 * inside — 97% of the pane against the 94% asked for.
 *
 * So the EDGE is taken in full — the first and last live vertex of every row
 * and of every column, which is the exact footprint and cheap at a few hundred
 * points — and the interior is thinned by stride on top of it, since an
 * interior point only ever matters if it is a peak. The highest vertex is kept
 * by name, because that one is never optional and a stride can miss it.
 */
let framePoints = [];

function pushPoint(positions, i) {
    framePoints.push(new THREE.Vector3(
        positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
}

function setFramePoints(positions, index, w, h) {
    framePoints = [];
    const n = positions.length / 3;
    if (!n) return;

    if (index) {
        for (let y = 0; y < h; y++) {
            let first = -1, last = -1;
            for (let x = 0; x < w; x++) {
                const v = index[y * w + x];
                if (v < 0) continue;
                if (first < 0) first = v;
                last = v;
            }
            if (first >= 0) { pushPoint(positions, first); pushPoint(positions, last); }
        }
        for (let x = 0; x < w; x++) {
            let first = -1, last = -1;
            for (let y = 0; y < h; y++) {
                const v = index[y * w + x];
                if (v < 0) continue;
                if (first < 0) first = v;
                last = v;
            }
            if (first >= 0) { pushPoint(positions, first); pushPoint(positions, last); }
        }
    }

    const stride = Math.max(1, Math.ceil(n / 600));
    let top = 0;
    for (let i = 0; i < n; i++) {
        if (positions[i * 3 + 1] > positions[top * 3 + 1]) top = i;
        if (i % stride === 0) pushPoint(positions, i);
    }
    pushPoint(positions, top);
}

/**
 * HOW MUCH OF THE PANE THE SURFACE TAKES.
 *
 * The margin is the reciprocal of the fill: 1.06 puts the picture's longer
 * side across 94% of the pane, which is as close to the edges as the surface
 * can sit and still have somewhere to swing when it is turned.
 *
 * It was briefly loosened to 1.25, along with an upward bias on the aim,
 * because the pane looked too big and sat low. Neither was true: the canvas
 * was being laid out at twice the pane on a 2x display (see resize), so the
 * picture on screen was a magnified crop of a correctly framed render. With
 * the canvas the size it says it is, a plain tight fit is right again.
 */
const FIT_MARGIN = 1.06;

function solveFrame(margin = FIT_MARGIN) {
    if (!camera || !controls || !host) return null;
    if (host.clientWidth < 2 || host.clientHeight < 2) return null;
    const lift = triadRelief * SIDE;

    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.copy(HOME_DIR);
    dir.normalize();

    const forward = dir.clone().negate();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    if (!Number.isFinite(right.x)) right.set(1, 0, 0);
    const camUp = new THREE.Vector3().crossVectors(right, forward).normalize();

    /* The surface's own points where there is a surface; failing that, the
       prism it would occupy — which is all there is to go on before a field
       has been generated. */
    const corners = framePoints.length ? framePoints : (() => {
        const box = [];
        for (const [gx, gy] of [[0, 0], [1, 0], [0.5, 1]]) {
            box.push(place(gx, gy, 0), place(gx, gy, lift));
        }
        return box;
    })();

    /* A first guess, orthographic and cheap, so the iteration starts close. */
    const target = new THREE.Vector3();
    for (const c of corners) target.add(c);
    target.multiplyScalar(1 / corners.length);

    const vfov = (camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vfov / 2);
    let distance = 0;
    for (const c of corners) {
        const o = c.clone().sub(target);
        distance = Math.max(distance,
            o.dot(forward) + Math.abs(o.dot(right)) / (tanV * camera.aspect),
            o.dot(forward) + Math.abs(o.dot(camUp)) / tanV);
    }
    distance = Math.max(distance, camera.near + 0.1) * margin;

    /* A scratch camera, so the solve never disturbs the live one — it is the
       thing being drawn, and half-solved positions must not reach the screen. */
    const probe = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    const v = new THREE.Vector3();
    /* UNDER-RELAXED, AND THE BEST PASS WINS.
     *
     * Correcting the offset and the distance in one step over-couples them:
     * moving the camera closer changes what "off-centre" is worth, so a
     * correction sized at the old distance overshoots at the new one. Applied
     * in full the pair can sit and oscillate — and since the loop simply
     * returned wherever it had got to, an oblique view came back with the
     * surface a fifth of a frame off-centre and overflowing the bottom, while
     * every measurement said the distance was the fitting one.
     *
     * Taking a fraction of each correction converges instead of ringing, and
     * remembering the best pass rather than the last means a run that does not
     * settle still returns its closest approach instead of its final stumble.
     */
    const RELAX = 0.6;
    let best = null, bestErr = Infinity;
    for (let pass = 0; pass < 48; pass++) {
        probe.position.copy(target).addScaledVector(dir, distance);
        probe.up.copy(up);
        probe.lookAt(target);
        probe.updateMatrixWorld(true);
        probe.updateProjectionMatrix();

        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const c of corners) {
            v.copy(c).project(probe);
            if (v.x < xMin) xMin = v.x; if (v.x > xMax) xMax = v.x;
            if (v.y < yMin) yMin = v.y; if (v.y > yMax) yMax = v.y;
        }
        if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) break;

        /* Where the picture's middle is, in fractions of a half-frame, and how
           much of the half-frame it takes up. */
        const offX = (xMin + xMax) / 2, offY = (yMin + yMax) / 2;
        const fill = Math.max((xMax - xMin) / 2, (yMax - yMin) / 2);

        const err = Math.max(Math.abs(offX), Math.abs(offY), Math.abs(fill * margin - 1));
        if (err < bestErr) {
            bestErr = err;
            best = { target: target.clone(), distance };
        }
        if (err < 1e-3) break;

        /* Slide the target to cancel the offset. A screen fraction is worth
           this much world at the target's own depth. */
        const halfH = tanV * distance, halfW = halfH * camera.aspect;
        target.addScaledVector(right, offX * halfW * RELAX)
            .addScaledVector(camUp, offY * halfH * RELAX);

        /* And scale the distance so the picture just fits inside the margin. */
        if (fill > 1e-6) {
            distance = Math.max(camera.near + 0.1,
                distance * Math.pow(fill * margin, RELAX));
        }
    }

    if (best) { target.copy(best.target); distance = best.distance; }
    return { dir, target, distance };
}

/**
 * The framing this pane would open on, as it was last solved.
 *
 * Kept so a resize can tell how far the user has moved from it — see resize,
 * which reapplies that difference against the NEW framing rather than
 * throwing it away or ignoring the new pane.
 */
let lastIdeal = null;

/**
 * What one CSS pixel is worth in the scene, at the framing the pane opens on
 * — the scale the shape-laid screen is pitched by, so that "6 px" means six
 * pixels at the fitted view and the dots then grow and shrink with the
 * zoom rather than re-laying themselves under it. Read from the last plain
 * fit rather than the live camera for exactly that reason; before there has
 * been one, from wherever the camera is.
 */
function worldPerPx() {
    if (!camera || !host) return 0.01;
    const h = Math.max(1, host.clientHeight);
    const dist = lastIdeal ? lastIdeal.distance
        : (controls ? camera.position.distanceTo(controls.target) : camera.position.length());
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    return (2 * dist * tanV) / h;
}

function applyFrame(f) {
    controls.target.copy(f.target);
    camera.position.copy(f.target).addScaledVector(f.dir, f.distance);
    camera.updateProjectionMatrix();
    controls.update();
}

function frameCamera(margin = FIT_MARGIN) {
    const f = solveFrame(margin);
    if (!f) return;
    applyFrame(f);
    /* Only a plain fit is a framing the pane measures itself against: the
       export's tight crop (see frameTight) is a one-off, and neither a later
       resize nor the shape-laid screen's pitch should be taken from it. */
    if (margin === FIT_MARGIN) lastIdeal = { target: f.target.clone(), distance: f.distance };
}

/**
 * Re-fit after the pane changed size, WITHOUT discarding what the user set up.
 *
 * The two things asked of a resize pull in opposite directions. The surface
 * has to keep filling the pane the way the flat one does — widen the pane and
 * the triangle should get bigger, not sit in the middle of new empty space —
 * and yet a resize is not a request to undo somebody's orbit and zoom, which
 * is what reframing outright used to do every time the side rail was opened.
 *
 * They are only in conflict if the user's framing is stored in absolute terms.
 * Stored RELATIVE to the framing the app would have chosen, both fall out at
 * once: how far they have zoomed is a ratio against the fitting distance, and
 * where they have panned to is an offset from the fitting target. Recompute
 * the fit for the new pane, put the ratio and the offset back on top, and the
 * picture scales with the pane while staying exactly where it was put.
 *
 * A user who has not touched anything has a ratio of 1 and no offset, so this
 * reduces to a plain fit — the flat pane's behaviour exactly.
 */
function refitPreservingUser() {
    const f = solveFrame();
    if (!f) return;
    if (!lastIdeal || !userPlaced) {
        applyFrame(f);
    } else {
        const ratio = camera.position.distanceTo(controls.target) / lastIdeal.distance;
        const pan = controls.target.clone().sub(lastIdeal.target);
        controls.target.copy(f.target).add(pan);
        camera.position.copy(controls.target)
            .addScaledVector(f.dir, f.distance * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
        camera.updateProjectionMatrix();
        controls.update();
    }
    lastIdeal = { target: f.target.clone(), distance: f.distance };
}

/**
 * Pull in as tight as the frustum allows, render once, and hand back what the
 * camera was before — for a PNG capture, where the live view's 6% breathing
 * room (frameCamera's default margin, kept so orbiting never clips the
 * surface against the edge) would leave the export looking like a screenshot
 * rather than a crop. Restore with restoreFrame once the pixels are read.
 */
export function frameTight(margin = 1.002) {
    if (!camera || !controls || !renderer || !scene) return null;
    const saved = {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        ideal: lastIdeal,
        placed: userPlaced,
    };
    frameCamera(margin);
    renderer.render(scene, camera);
    return saved;
}

/** Undo frameTight, and repaint so the live pane is back to what it was. */
export function restoreFrame(saved) {
    if (!saved || !camera || !controls || !renderer || !scene) return;
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    /* The export's tight crop is not a framing the live pane should measure
       itself against later, so what it overwrote comes back with it. */
    lastIdeal = saved.ideal;
    userPlaced = saved.placed;
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene, camera);
}

/* ---------------------------------------------------------------------
 *  Building the scene
 *
 *  Separated from drawing because it is the expensive half: a 420-square grid
 *  is a hundred thousand vertices, and it only changes when the field, the
 *  relief, the colormap or the lattice does.
 * ------------------------------------------------------------------ */

let builtKey = '';

export function rebuild(o, force = false) {
    if (!scene) return;
    opts = o;
    const field = currentField();
    const E = equaveCents(o.equaveRatio);
    const key = JSON.stringify([
        field ? [field.w, field.h, field.min, field.max] : null,
        triadRelief, triadFill, triadLines, triadContours, triadDots, triadLabels,
        o.equaveRatio, o.baseSize, o.scalingFactor, o.enableSize, o.enableColor, o.latticeOpacity,
        layoutSignature(currentLayoutMode), triadGloss, currentTriads().length,
    ]);
    if (!force && key === builtKey) return;
    builtKey = key;

    scene.background = new THREE.Color(groundColor());
    marker.material.color.set(onLight() ? 0x111111 : 0xffffff);

    for (const item of [surface, lattice, labels, lines]) {
        if (item) { world.remove(item); disposeDeep(item); }
    }
    surface = lattice = labels = lines = null;

    /* A material layout is modelled by light rather than by value, so the fill
       comes down to let the key actually carve the relief; a value-coloured
       surface wants flat, even light so the colours read as the numbers they
       are rather than as shading. */
    /* A material layout is modelled by light, so its fill comes down to let
       the key actually carve the relief; a value-coloured surface wants flat,
       even light so the colours read as the numbers they are. */
    const material = colormapMaterial();
    if (material) {
        /* Ambient and key have to SUM to about one, not each be about one.
           A pale body under 0.43 fill and 0.95 key is asking for 1.38x its own
           colour, so most of the surface clips to flat white — the relief goes
           with it, and a specular highlight has nowhere left to go, which is
           exactly what made Gloss do nothing on a near-white constant. */
        fillLight.intensity = material.ambient ?? 0.3;
        keyLight.intensity = Math.max(0.35, 1 - fillLight.intensity);
    } else {
        /* A value-coloured surface wants flat, even light so the colours read
           as the numbers they are rather than as shading. */
        fillLight.intensity = 0.62;
        keyLight.intensity = 0.7;
    }

    surface = field ? buildSurface(field) : buildPlate();
    /* LINES WITHOUT FILL DRAWS NO SURFACE.  The contours are meant to hang in
       space, so the thing they were lying on is not rendered — but it is still
       ADDED, because it is what the pointer picks against: hovering and
       playing a chord both raycast the surface, and a mode that quietly
       stopped responding to the mouse would be a poor trade for a look.
     *
     * Turned off through the material rather than through `visible`, which is
     * the part worth stating: an invisible object is skipped by some versions
     * of the raycaster, and picking is exactly what has to keep working.
     * Writing neither colour nor depth draws literally nothing and, just as
     * importantly, leaves the depth buffer alone — a surface that still wrote
     * depth would hide every contour line behind it. */
    if (field && triadLines && !triadFill) {
        for (const m of [].concat(surface.material)) {
            m.colorWrite = false;
            m.depthWrite = false;
        }
    }
    world.add(surface);

    if (field && triadLines) { lines = buildContourLines(field); if (lines) world.add(lines); }
    if (triadDots) { lattice = buildLattice(E, o); if (lattice) world.add(lattice); }
    if (triadLabels) { labels = buildLabels(E, o); if (labels) world.add(labels); }

    /* No re-frame here on purpose: Relief (and everything else that forces a
       rebuild) changes the geometry, not the view the user has set up. A
       camera that snapped back to centre on every drag of the slider would
       fight anyone trying to orbit the surface while adjusting it. The
       camera is only ever framed explicitly — see fitView, called on entering
       the mode, on a resize, and after the field itself changes. */
}

function disposeDeep(root) {
    root.traverse?.((n) => {
        n.geometry?.dispose?.();
        if (n.material) {
            const mats = Array.isArray(n.material) ? n.material : [n.material];
            for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
        }
    });
    root.geometry?.dispose?.();
    root.material?.dispose?.();
}

/** The height a field value is lifted to. */
function heightOf(field, v) {
    return normalise(field, v) * triadRelief * SIDE;
}

function buildSurface(field) {
    const { w, h } = field;
    const positions = [];
    const colors = [];
    const values = [];
    const index = new Int32Array(w * h).fill(-1);
    const map = colormapFn();
    const material = colormapMaterial();
    const flat = !triadFill;
    const screened = halftoneOn();

    let n = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = field.z[y * w + x];
            if (!(v === v)) continue;
            const p = place(x / (w - 1), y / (h - 1), heightOf(field, v));
            positions.push(p.x, p.y, p.z);
            /* With Fill off the surface keeps its shape but loses its shading,
               so the contour lines on it are the only thing carrying value —
               which is exactly what Lines-without-Fill means in the flat pane. */
            const c = flat
                ? (onLight() ? { r: .88, g: .89, b: .92 } : { r: .16, g: .17, b: .21 })
                : map(normalise(field, v));
            colors.push(c.r, c.g, c.b);
            values.push(flat ? 0 : normalise(field, v));
            index[y * w + x] = n++;
        }
    }
    if (!n) return buildPlate();

    /* ---- the boundary cells ----
     *
     * A cell used to be emitted only when all four of its corners were inside
     * the triangle, and dropped entirely otherwise. That is right for the
     * baseline, which runs along a row of the grid and so has cells that are
     * cleanly all-in or all-out — and it is why the bottom edge came out
     * straight. It is wrong for the two slanted edges, which cut diagonally
     * across the grid: every cell they pass through has three corners in and
     * one out, so every one of them was thrown away and the silhouette became
     * a staircase of whole cells.
     *
     * Emitting the triangle formed by the three corners that ARE inside costs
     * one test and closes the staircase exactly. Exactly, not approximately:
     * the mask's diagonal is the line x + y = constant in grid indices, and
     * when the far corner (x+1, y+1) is the one outside, that line passes
     * precisely through the other two — so the triangle a-b-d has the mask's
     * own edge as its hypotenuse. The same holds on the other slant.
     *
     * The corners are taken in cycle order, so dropping one leaves the
     * remaining three wound the same way as the two triangles of a full cell.
     */
    const tris = [];
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const a = index[y * w + x], b = index[y * w + x + 1];
            const c = index[(y + 1) * w + x + 1], d = index[(y + 1) * w + x];
            const out = (a < 0) + (b < 0) + (c < 0) + (d < 0);
            if (out === 0) { tris.push(a, b, c, a, c, d); continue; }
            /* Two or more corners missing is a corner of the mask rather than
               a crossing of it: there is no three-corner face to make, and
               anything drawn would be outside the triangle. */
            if (out > 1) continue;
            if (a < 0) tris.push(b, c, d);
            else if (b < 0) tris.push(a, c, d);
            else if (c < 0) tris.push(a, b, d);
            else tris.push(a, b, c);
        }
    }

    setFramePoints(positions, index, w, h);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (!material) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(tris);
    geo.computeVertexNormals();

    if (screened) {
        geo.setAttribute('value', new THREE.Float32BufferAttribute(values, 1));
        return new THREE.Mesh(geo, new THREE.ShaderMaterial({
            uniforms: halftoneUniforms(renderer.getPixelRatio(), worldPerPx()),
            vertexShader: HALFTONE_VERT,
            fragmentShader: HALFTONE_FRAG,
            side: THREE.DoubleSide,
            /* The shape lay softens its edges with fwidth, which on a WebGL1
               context is an extension three has to be asked to turn on. */
            extensions: { derivatives: true },
        }));
    }

    /* One Phong surface for both kinds, differing only in what it is given —
       see `lighting` in color-mapping.js. A material layout puts its body
       colour in and takes all its modelling from the light; a ramp layout
       leaves the colour to the vertices (so `color` must be white, which
       multiplies through unchanged) and takes only a highlight.

       Lambert would do for a ramp at Gloss 0 and cannot do anything above it,
       and at Gloss 0 the specular here is black — which is Lambert. */
    const lit = lighting(colormap(), triadGloss);
    const surfaceMaterial = new THREE.MeshPhongMaterial({
        color: material ? material.color : 0xffffff,
        vertexColors: !material,
        specular: lit.specular,
        shininess: lit.shininess,
        side: THREE.DoubleSide,
        flatShading: false,
    });

    return new THREE.Mesh(geo, surfaceMaterial);
}

/** No model: the triangle itself, so the lattice has something to sit on. */
function buildPlate() {
    const geo = new THREE.BufferGeometry();
    const [a, b, c] = [place(0, 0), place(1, 0), place(0.5, 1)];
    /* A flat triangle: the three corners are the whole of it. */
    setFramePoints([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], null, 0, 0);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
        [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], 3));
    geo.computeVertexNormals();
    const material = colormapMaterial();
    const lit = lighting(colormap(), triadGloss);
    /* Screened, the plate is the page itself: nothing under the lattice but
       the ground, and nothing lit. */
    if (halftoneOn()) {
        return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: groundHex(), side: THREE.DoubleSide }));
    }
    return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
        color: material ? material.color : (onLight() ? 0xf2f3f6 : 0x0b0c10),
        specular: lit.specular,
        shininess: lit.shininess,
        side: THREE.DoubleSide,
    }));
}

/**
 * The contour lines, drawn on the surface rather than under it.
 *
 * Lifted a hair above the height they mark so they are not swallowed by the
 * very triangles they are level with — the same job a polygon offset does, in
 * the one place it is needed.
 */
function buildContourLines(field) {
    const segs = contourSegments(field, triadContours);
    if (!segs.length) return null;
    const pts = [];
    const cols = [];
    const map = colormapFn();
    const lift = 0.004 * SIDE;
    for (let i = 0; i < segs.length; i += 5) {
        for (const [gx, gy] of [[segs[i], segs[i + 1]], [segs[i + 2], segs[i + 3]]]) {
            const v = sampleField(field, gx, gy);
            const p = place(gx, gy, (v === v ? heightOf(field, v) : 0) + lift);
            pts.push(p.x, p.y, p.z);
            /* Over a material surface the lines are the only thing saying
               what the values ARE, so they keep their ramp instead of being
               dimmed to a wash the way they are over a coloured field. */
            const c = (triadFill && !colormapMaterial())
                ? (onLight() ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 })
                : map(segs[i + 4]);
            cols.push(c.r, c.g, c.b);
        }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pts);
    geo.setColors(cols);
    /* `resolution` is how the shader turns a width in pixels into a quad in
       clip space, so it is the pane's size and has to be re-set whenever the
       pane is resized — see resize(). Left stale, the lines keep the thickness
       they had at the old size. */
    const mat = new LineMaterial({
        vertexColors: true,
        linewidth: triadLineWidth,
        transparent: true,
        /* Screened, the contours are in the ink and all of it. */
        opacity: halftoneOn() ? 1 : (triadFill && !colormapMaterial()) ? 0.35 : 0.9,
    });
    mat.resolution.set(
        Math.max(1, host ? host.clientWidth : 1),
        Math.max(1, host ? host.clientHeight : 1));
    const seg = new LineSegments2(geo, mat);
    /* LineSegmentsGeometry stores its endpoints in instanced attributes, and
       the bounding sphere three derives from those comes out empty — so the
       whole object tests as off-screen and is culled before it is ever drawn.
       There is exactly one of these and it is always inside the view the
       camera was just framed to, so the test is not worth having. */
    seg.frustumCulled = false;
    seg.computeLineDistances();
    return seg;
}

/** Where a triad sits on the surface — on the field if there is one. */
function liftTriad(t, E, field) {
    const { gx, gy } = centsToShape(t.c1, t.c2, E);
    const v = field ? sampleField(field, gx, gy) : NaN;
    const z = (v === v ? heightOf(field, v) : 0) + 0.012 * SIDE;
    return place(gx, gy, z);
}

function latticeColor(t, range, o) {
    if (!o.enableColor) return onLight() ? { r: .07, g: .07, b: .07 } : { r: 1, g: 1, b: 1 };
    const span = range.hi - range.lo;
    const norm = span > 1e-12 ? (t.complexity - range.lo) / span : 0.5;
    return colormapFn()(Math.min(1, Math.max(0, (1 - norm) * (o.scalingFactor / 2))));
}

function buildLattice(E, o) {
    const triads = currentTriads();
    if (!triads.length) return null;
    const field = currentField();
    const range = complexityRange();
    const span = range.hi - range.lo;

    const pos = [];
    const cols = [];
    const sizes = [];
    for (const t of triads) {
        if (t.c1 + t.c2 > E + 1e-6) continue;
        const p = liftTriad(t, E, field);
        pos.push(p.x, p.y, p.z);
        const c = latticeColor(t, range, o);
        cols.push(c.r, c.g, c.b);
        const norm = span > 1e-12 ? (t.complexity - range.lo) / span : 0.5;
        sizes.push(o.enableSize ? (1 + (1 - norm) * (o.scalingFactor - 1)) : 1);
    }
    if (!pos.length) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    /* One Points object rather than one sphere each: a 15-limit set is a few
       hundred dots and a 27-limit one is tens of thousands. */
    const faint = o.latticeOpacity ?? 1;
    return new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.035 * o.baseSize * SIDE / 3, vertexColors: true, sizeAttenuation: true,
        /* As faint as the panel asks — Complexity channels › Opacity. Depth
           is left unwritten by a faint point so the surface behind it is not
           cut out where the point was. */
        transparent: faint < 1, opacity: faint, depthWrite: faint >= 1,
    }));
}

const labelCache = new Map();

function labelSprite(text, color) {
    const key = `${text}|${color}`;
    let tex = labelCache.get(key);
    if (!tex) {
        const c = document.createElement('canvas');
        const g = c.getContext('2d');
        const size = 40;
        g.font = `${size}px monospace`;
        c.width = Math.ceil(g.measureText(text).width);
        c.height = Math.ceil(size * 1.35);
        g.font = `${size}px monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = color;
        g.fillText(text, c.width / 2, c.height / 2);
        tex = new THREE.CanvasTexture(c);
        tex.userData = { aspect: c.width / c.height };
        labelCache.set(key, tex);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.userData.aspect = tex.userData.aspect;
    return sprite;
}

function buildLabels(E, o) {
    const triads = currentTriads();
    if (!triads.length) return null;
    const field = currentField();
    const range = complexityRange();
    const group = new THREE.Group();

    /* A label is a sprite with a texture, and ten thousand of those is a
       texture upload per chord. The simplest are the ones worth naming, so
       past a threshold only those get names — which is also the order they
       are wanted in. */
    const CAP = 900;
    const shown = triads.length <= CAP
        ? triads
        : triads.slice(triads.length - CAP);

    for (const t of shown) {
        if (t.c1 + t.c2 > E + 1e-6) continue;
        const c = latticeColor(t, range, o);
        const css = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        const sprite = labelSprite(t.label, css);
        sprite.material.opacity = o.latticeOpacity ?? 1;
        const p = liftTriad(t, E, field);
        sprite.position.set(p.x, p.y + 0.05, p.z);
        const s = 0.12 * o.baseSize;
        sprite.scale.set(s * sprite.userData.aspect, s, 1);
        group.add(sprite);
    }
    return group.children.length ? group : null;
}

/* ---------------------------------------------------------------------
 *  Drawing
 * ------------------------------------------------------------------ */

export function draw(o) {
    opts = o;
    if (!renderer) return;
    rebuild(o);

    /* Line size, without a rebuild.
     *
     * It is deliberately NOT part of rebuild's key. Everything in that key
     * changes the GEOMETRY, and rebuilding is a hundred thousand vertices —
     * far too much to spend on a slider being dragged. The width is a uniform
     * on the line material, so it can simply be assigned, and LineMaterial's
     * setter writes it straight through to the shader. One comparison a frame
     * buys a control that keeps up with the hand moving it. */
    if (lines && lines.material.linewidth !== triadLineWidth) {
        lines.material.linewidth = triadLineWidth;
    }
    /* The screen's pitch and its lay, likewise uniforms rather than a rebuild. */
    if (surface && surface.material.uniforms) {
        syncHalftoneUniforms(surface.material, renderer.getPixelRatio(), worldPerPx());
    }

    if (cursor.live) {
        const E = equaveCents(o.equaveRatio);
        const field = currentField();
        const { gx, gy } = centsToShape(cursor.c1, cursor.c2, E);
        const v = field ? sampleField(field, gx, gy) : NaN;
        const p = place(gx, gy, (v === v ? heightOf(field, v) : 0) + 0.05);
        marker.position.copy(p);
        marker.visible = true;
    } else {
        marker.visible = false;
    }
}

/** One frame. The orchestrator's loop calls this only while the pane is up. */
export function render() {
    if (!renderer || !scene || !camera) return;
    controls.update();

    /* Turned exactly the way the tetrahedron is turned, off the same three
       settings: the arrow keys nudge it, Rotate Continuously latches it, and
       [ and ] set the rate — one rate for both, so the Motion readout means
       the same thing in either mode. While it is latched an arrow steers
       rather than nudges, which is decided in three-visualizer.js and reaches
       here as autoRotateDir.
       
       The WORLD turns, not the camera: the lights hang off the camera, so a
       turning object moves under a fixed lamp and the specular highlight
       travels across the peaks. Turning the camera instead would carry the
       lamp with it and the surface would look painted. */
    const turn = autoRotate ? autoRotateDir
        : keyState.ArrowUp ? 'ArrowUp' : keyState.ArrowDown ? 'ArrowDown'
        : keyState.ArrowLeft ? 'ArrowLeft' : keyState.ArrowRight ? 'ArrowRight' : null;

    if (world && turn) {
        if (turn === 'ArrowUp') world.rotation.x -= rotationSpeed;
        else if (turn === 'ArrowDown') world.rotation.x += rotationSpeed;
        else if (turn === 'ArrowLeft') world.rotation.y -= rotationSpeed;
        else world.rotation.y += rotationSpeed;
    }

    renderer.render(scene, camera);
}

/* ---------------------------------------------------------------------
 *  The gesture
 *
 *  Tetrads' arrangement, so that a modifier means one thing in this app:
 *  a plain drag TURNS the shape and Shift SOUNDS it, exactly as it does over
 *  the tetrahedron. Isoharmonics has it the other way round — plain drag
 *  plays, Shift orbits — which is defensible on its own but would make Shift
 *  mean "play" in one mode of this app and "don't play" in the other.
 *
 *  The flat pane keeps the plain drag for playing, because there is nothing to
 *  turn there; Shift plays in both, so the habit carries whichever pane the
 *  pointer is over.
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function bindPointer() {
    const el = renderer.domElement;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || !ev.shiftKey) return;   // a plain drag orbits
        const hit = pick(ev);
        if (!hit) return;
        /* OrbitControls has already seen this press, so it is not enough to
           stop listening — it has to be switched off, or the shape turns
           under the chord being played. */
        controls.enabled = false;
        dragging = true;
        el.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        onGesture?.('down', hit);
    });

    el.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        const hit = pick(ev);
        if (hit) onGesture?.('move', hit);
    });

    const up = (ev) => {
        if (!dragging) return;
        dragging = false;
        controls.enabled = true;
        try { if (ev.pointerId !== undefined) el.releasePointerCapture(ev.pointerId); } catch (e) {}
        onGesture?.('up', null);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    /* Letting go of Shift while still dragging ends the note. Without this the
       drag would carry on sounding with the modifier that authorised it gone,
       and the pointer would be playing and orbiting at the same time. */
    window.addEventListener('keyup', (ev) => {
        if (ev.key === 'Shift' && dragging) up({ pointerId: undefined });
    });
}

/**
 * The chord under the pointer.
 *
 * The surface is hit first, because on a tall relief the visible summit is not
 * above the triangle position it belongs to and only a real intersection gets
 * that right. If the ray misses the surface — over the sky, or through a hole
 * in the mask — it is dropped onto the base plane instead, so a drag that runs
 * off the top of a peak carries on rather than stopping.
 */
function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    let point = null;
    if (surface) {
        const hits = raycaster.intersectObject(surface, false);
        if (hits.length) point = hits[0].point.clone();
    }
    if (!point) {
        /* The triangle's own ground plane, carried through whatever rotation
           the world is currently under — a fixed y=0 plane would be the right
           answer only while the shape happened to be upright. */
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
            .applyMatrix4(world.matrixWorld);
        const p = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, p)) return null;
        point = p;
    }

    /* The arrow keys turn the world group, so a hit reported in scene space
       has to be brought back into the triangle's own frame before it can be
       read as two intervals — otherwise playing a surface you have rotated
       would sound a different chord from the one under the pointer. */
    world.worldToLocal(point);

    const E = equaveCents(opts.equaveRatio);
    const { gx, gy } = unplace(point);
    const raw = shapeToCents(gx, gy, E);
    const c = clampCents(raw.c1, raw.c2, E);

    if (triadSnap > 0 && (triadDots || triadLabels)) {
        /* Snapping in the lifted pane is measured in cents rather than in
           pixels: a dot's distance on screen here depends on how the surface
           happens to be turned, which is not something the chord should. The
           conversion keeps the two panes feeling like one setting. */
        const tol = (triadSnap / 260) * E;
        let best = null, bestD = tol;
        for (const t of currentTriads()) {
            const d = Math.hypot(t.c1 - c.c1, t.c2 - c.c2);
            if (d <= bestD) { bestD = d; best = t; }
        }
        if (best) return { c1: best.c1, c2: best.c2, label: best.label, snapped: true };
    }
    return { c1: c.c1, c2: c.c2, label: null, snapped: false };
}

/** The canvas, for the PNG exporter. */
export function domElement() { return renderer ? renderer.domElement : null; }


