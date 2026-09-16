/* =====================================================================
 *  TETRADS — the field, drawn
 * =====================================================================
 *
 * Harmonic entropy over the tetrahedron is a scalar on a volume, and a volume
 * cannot be looked at the way a surface can: every point is behind some other
 * point. Two pictures of it are drawn here, into the tetrahedron's own scene,
 * under the sprites it has always shown:
 *
 *   THE BODY   the whole field as a translucent solid, rendered by marching a
 *              ray through it from the eye — each step reads the entropy at
 *              its point, turns it into a colour and a little opacity, and
 *              deposits them front to back. Concordance is opaque and
 *              discordance is clear, so what appears is a constellation of
 *              wells hanging in a haze, and turning the shape turns the
 *              constellation.
 *   THE CUT    a plane through the field, opaque, coloured by the entropy
 *              exactly where it cuts — a tomograph's section. It is always
 *              parallel to a face, which is what makes it a triangle and
 *              makes it MEAN something (see sliceTriangle): the cut parallel
 *              to the base is every tetrad with the same outer interval, with
 *              the two inner voices free to roam across it.
 *
 * Either alone, or the two together, which is the picture the mode is for: a
 * bright section moving through a ghost. The body stops at the cut on the
 * eye's side of it, so the section reads as a face of a solid you have opened
 * rather than as a card floating in smoke.
 *
 * ONE TEXTURE, ON THE GPU.  The field comes from Python as a cube of floats
 * and goes to the card once, as an 8-bit 3D texture; both pictures read it
 * from there, through one lookup table that is the app's own colormap. So a
 * colormap change is a 256-pixel upload rather than a rebuild, and moving the
 * cut is three vertices — cheap enough to sweep it every frame.
 *
 * WHY WEBGL2.  A 3D texture with trilinear filtering is what makes the ray
 * march and the section both smooth, and it is a WebGL2 feature. three.js
 * gets a WebGL2 context wherever one exists, which is every browser of the
 * last few years; where it does not, the field is reported unavailable
 * rather than faked.
 *
 * THE GESTURE.  Shift-drag on the cut sounds the tetrad under the pointer and
 * leads it across the section — Tetrads' own modifier, and the triangle's
 * own gesture, so playing a surface means one thing across the app. A plain
 * drag still turns the shape and Shift over a point still sounds the point.
 * ------------------------------------------------------------------ */

import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';
import {
    scene, camera, renderer, controls, isClickPlayModeActive, currentLayoutMode,
} from '../globals.js';
import { colormapAt, isLightGround } from '../calculations/color-mapping.js';
import { HALFTONE_GLSL, halftoneUniforms, syncHalftoneUniforms } from '../calculations/halftone.js';
import {
    FRAME, baryToLocal, localToBary, clampBary, centsToBary, baryToCents,
    sliceTriangle, slicePlane, equaveCents, normaliseVolume, sampleVolume,
} from './tetrad-geometry.js';
import {
    tetradSlice, tetradVolume, tetradAxis, tetradPosition, setTetradPosition,
    tetradSweep, tetradDensity, tetradFocus, tetradSnap, cursor,
} from './tetrad-state.js';
import { currentVolume } from './tetrad-volume.js';

let group = null;
let edges = null;       // the shape's own edges, for a cut shown on its own
let body = null;        // the ray-marched volume
let cut = null;         // the section
let marker = null;      // the cursor bead
let volTex = null;
let lutTex = null;
let onGesture = null;
let getOpts = null;     // () => { equaveRatio, tetrads }
let onSweep = null;
let dragging = false;
let ready = false;      // a field is loaded on the GPU

/** How many steps a ray takes through the body. */
const STEPS = 160;
/** Opacity per unit of scene length at density 1 and full concordance.
 *  High, because a well is small: a 17 ¢ spread is a twentieth of an edge,
 *  so a ray crosses the whole of one in a tenth of a unit and has to be able
 *  to pick up most of its opacity in that. The haze between wells is kept
 *  down by Focus, not by this. */
const OPACITY_SCALE = 40.0;

/* ---------------------------------------------------------------------
 *  The shaders
 *
 *  GLSL ES 3.00, because sampler3D is. three prepends the version line and
 *  the float precision; the sampler precision is ours to declare.
 * ------------------------------------------------------------------ */
const VERT = /* glsl */`
out vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* Shared by both fragment shaders: a scene point → barycentric coordinates →
   the entropy at it, 0 (the most concordant cell) to 1, through the texture's
   trilinear filter; and the colour that concordance is drawn in. The texture
   is stored [c₁][c₂][c₃] with c₃ fastest, which is texture x. */
const COMMON = /* glsl */`
precision highp sampler3D;
uniform sampler3D uVol;
uniform sampler2D uLut;
uniform mat3 uToBary;
uniform vec3 uApex;
uniform float uR;
uniform int uHtMethod;
uniform float uHtCell;
uniform vec3 uHtInk;
uniform vec3 uHtGround;
in vec3 vLocal;
out vec4 outColor;
` + HALFTONE_GLSL + /* glsl */`

vec3 toBary(vec3 p) { return uToBary * (p - uApex); }
float entropyAt(vec3 b) {
    vec3 t = (vec3(b.z, b.y, b.x) * (uR - 1.0) + 0.5) / uR;
    return texture(uVol, t).r;
}
vec3 shade(float conc) { return texture(uLut, vec2(clamp(conc, 0.0, 1.0), 0.5)).rgb; }
`;

const CUT_FRAG = COMMON + /* glsl */`
void main() {
    float conc = 1.0 - entropyAt(toBary(vLocal));
    /* Screened: the section is a page, and the tone is a screen of the
       concordance laid in screen space, like the flat pane's. */
    if (uHtMethod > 0) {
        float c = halftoneCoverage(gl_FragCoord.xy, conc, uHtCell, uHtMethod);
        outColor = vec4(mix(uHtGround, uHtInk, c), 1.0);
        return;
    }
    outColor = vec4(shade(conc), 1.0);
}`;

const BODY_FRAG = COMMON + /* glsl */`
uniform vec3 uCam;
uniform float uDensity;
uniform float uFocus;
uniform int uSteps;
uniform vec4 uCut;
uniform float uCutOn;
uniform float uScale;

void main() {
    /* Back faces are drawn, so vLocal is where the ray LEAVES the shape and
       the eye may be inside it; the entry is found from the four half-spaces
       rather than assumed. In barycentric coordinates the ray is a straight
       line, so each constraint is one division. */
    vec3 dir = normalize(vLocal - uCam);
    vec3 b0 = toBary(uCam);
    vec3 bd = uToBary * dir;
    vec4 c0 = vec4(b0, 1.0 - b0.x - b0.y - b0.z);
    vec4 cd = vec4(bd, -(bd.x + bd.y + bd.z));
    float tmin = 0.0, tmax = 1e9;
    for (int i = 0; i < 4; i++) {
        float a = c0[i], d = cd[i];
        if (d < 0.0) tmax = min(tmax, -a / d);
        else if (d > 0.0) tmin = max(tmin, -a / d);
        else if (a < 0.0) discard;
    }
    /* The march stops at the cut when it crosses it inside the shape: the
       section is opaque and already drawn, and what lies beyond it is the
       part that has been opened up. A crossing outside the shape is a ray
       that misses the section, and marches on. */
    if (uCutOn > 0.5) {
        float s0 = dot(uCut.xyz, b0) + uCut.w;
        float sd = dot(uCut.xyz, bd);
        if (abs(sd) > 1e-9) {
            float ts = -s0 / sd;
            if (ts > tmin) tmax = min(tmax, ts);
        }
    }
    if (tmax <= tmin) discard;

    float dt = (tmax - tmin) / float(uSteps);
    vec3 acc = vec3(0.0);
    float alpha = 0.0;
    for (int i = 0; i < 512; i++) {
        if (i >= uSteps) break;
        float t = tmin + (float(i) + 0.5) * dt;
        float conc = 1.0 - entropyAt(b0 + t * bd);
        float a = 1.0 - exp(-uDensity * pow(conc, uFocus) * dt * uScale);
        acc += (1.0 - alpha) * a * shade(conc);
        alpha += (1.0 - alpha) * a;
        if (alpha > 0.985) break;
    }
    /* Screened: what the ray accumulated is a TONE, and the tone is put on
       the page as a screen — a dot sized by the body's opacity along that
       ray, in the ink, over whatever is behind. Squared first: a body dense
       enough to read in colour is a solid in one ink, and the square keeps
       the haze a light stipple while the wells stay full. */
    if (uHtMethod > 0) {
        float c = halftoneCoverage(gl_FragCoord.xy, alpha * alpha, uHtCell, uHtMethod);
        outColor = vec4(uHtInk * c, c);
        return;
    }
    outColor = vec4(acc, alpha);
}`;

/* ---------------------------------------------------------------------
 *  Setting up
 * ------------------------------------------------------------------ */

/**
 * Put the field's objects into the tetrahedron's scene.
 *
 * @param {(kind:'down'|'move'|'up', hit:object|null)=>void} gestureHandler
 * @param {() => {equaveRatio:number, tetrads:Array}} opts  how to read the
 *        panel and the current set, asked at pick time rather than held
 * @param {(t:number)=>void} sweepHandler  told where the sweep has put the cut
 */
export function attachField(gestureHandler, opts, sweepHandler) {
    onGesture = gestureHandler;
    getOpts = opts;
    onSweep = sweepHandler;
    if (group) return;

    group = new THREE.Group();
    /* updateTetrahedron replaces the scene's children wholesale when the set
       is rebuilt; this is the one child it is asked to keep. */
    group.userData.persistent = true;
    group.name = 'tetrad-field';
    scene.add(group);

    /* One texel of nothing until a field arrives, so the materials compile
       against a real sampler and the objects can exist unshown. */
    volTex = new THREE.DataTexture3D(new Uint8Array([255]), 1, 1, 1);
    volTex.format = THREE.RedFormat;
    volTex.type = THREE.UnsignedByteType;
    volTex.minFilter = THREE.LinearFilter;
    volTex.magFilter = THREE.LinearFilter;
    volTex.wrapS = volTex.wrapT = volTex.wrapR = THREE.ClampToEdgeWrapping;
    volTex.unpackAlignment = 1;
    volTex.needsUpdate = true;

    lutTex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
    lutTex.minFilter = THREE.LinearFilter;
    lutTex.magFilter = THREE.LinearFilter;
    lutTex.wrapS = THREE.ClampToEdgeWrapping;
    lutTex.needsUpdate = true;

    const shared = () => ({
        uVol: { value: volTex },
        uLut: { value: lutTex },
        uToBary: { value: FRAME.Minv },
        uApex: { value: FRAME.apex },
        uR: { value: 1 },
        ...halftoneUniforms(renderer.getPixelRatio()),
    });

    /* ---- the body ---- */
    const [A, B1, B2, B3] = FRAME.corners;
    const centre = A.clone().add(B1).add(B2).add(B3).multiplyScalar(0.25);
    const faces = [[A, B1, B2], [A, B2, B3], [A, B3, B1], [B1, B3, B2]];
    const pos = [];
    for (const f of faces) {
        /* Wound to face outward, so BackSide means the far side. */
        const n = new THREE.Vector3().subVectors(f[1], f[0]).cross(new THREE.Vector3().subVectors(f[2], f[0]));
        const out = f[0].clone().sub(centre).dot(n) > 0;
        const [a, b, c] = out ? f : [f[0], f[2], f[1]];
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    body = new THREE.Mesh(bodyGeo, new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
            ...shared(),
            uCam: { value: new THREE.Vector3() },
            uDensity: { value: tetradDensity },
            uFocus: { value: tetradFocus },
            uSteps: { value: STEPS },
            uCut: { value: new THREE.Vector4(1, 1, 1, -0.5) },
            uCutOn: { value: 0 },
            uScale: { value: OPACITY_SCALE },
        },
        vertexShader: VERT,
        fragmentShader: BODY_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        /* Premultiplied — the shader accumulates colour already weighted by
           its own alpha, so the ground is mixed in by the remaining alpha. */
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
    }));
    body.renderOrder = 10;
    body.frustumCulled = false;
    body.visible = false;
    group.add(body);

    /* ---- the cut ---- */
    const cutGeo = new THREE.BufferGeometry();
    cutGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    cut = new THREE.Mesh(cutGeo, new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: shared(),
        vertexShader: VERT,
        fragmentShader: CUT_FRAG,
        side: THREE.DoubleSide,
    }));
    cut.renderOrder = 1;
    cut.frustumCulled = false;
    cut.visible = false;
    group.add(cut);

    /* ---- the edges of the shape ----
       Only while the cut is shown on its own: a section floating with nothing
       around it needs the shape it was cut from to be read against, and the
       body, when it is up, IS that shape. The cut itself has no outline — it
       reads as a shape by its own colour. */
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    edges = new THREE.LineSegments(new THREE.EdgesGeometry(hullGeo), new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.28,
    }));
    edges.visible = false;
    group.add(edges);

    /* ---- the bead ---- */
    marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    marker.renderOrder = 3;
    marker.visible = false;
    group.add(marker);

    bindPointer();
    restyleField();
}

/** Whether the card can draw this at all. */
export function fieldSupported() {
    return !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
}

/* ---------------------------------------------------------------------
 *  Loading a field
 * ------------------------------------------------------------------ */

/**
 * Send the current volume to the card, as 8 bits of normalised entropy per
 * cell — 0 the most concordant cell in the simplex, 255 the least or nothing
 * at all. Trilinear filtering across the faces reads the true values the
 * padding put there, which is why the cube was not masked at the simplex.
 */
export function rebuildField() {
    if (!group) return;
    const vol = currentVolume();
    if (!vol || !fieldSupported()) {
        ready = false;
        syncVisibility();
        return;
    }
    const R = vol.r;
    const bytes = new Uint8Array(R * R * R);
    const span = vol.max - vol.min;
    const z = vol.z;
    for (let i = 0; i < z.length; i++) {
        const v = z[i];
        if (!(v === v)) { bytes[i] = 255; continue; }
        let t = span > 1e-12 ? (v - vol.min) / span : 0.5;
        if (vol.up > 0) t = 1 - t;   // stored as entropy: 0 is concordant
        bytes[i] = Math.round(Math.min(1, Math.max(0, t)) * 255);
    }
    volTex.dispose();
    volTex = new THREE.DataTexture3D(bytes, R, R, R);
    volTex.format = THREE.RedFormat;
    volTex.type = THREE.UnsignedByteType;
    volTex.minFilter = THREE.LinearFilter;
    volTex.magFilter = THREE.LinearFilter;
    volTex.wrapS = volTex.wrapT = volTex.wrapR = THREE.ClampToEdgeWrapping;
    volTex.unpackAlignment = 1;
    volTex.needsUpdate = true;
    for (const m of [body.material, cut.material]) {
        m.uniforms.uVol.value = volTex;
        m.uniforms.uR.value = R;
    }
    ready = true;
    updateSlice();
    syncVisibility();
}

/** Drop the field from the screen — what Blank does. */
export function clearField() {
    ready = false;
    syncVisibility();
}

/**
 * The colormap, the ground and the theme — a 256-pixel upload and two
 * material colours. Called whenever the layout changes, from the same place
 * the sprites are recoloured.
 */
export function restyleField() {
    if (!group) return;
    const map = colormapAt(currentLayoutMode);
    const data = lutTex.image.data;
    for (let i = 0; i < 256; i++) {
        const c = map.ramp(i / 255);
        data[i * 4] = Math.round(c.r * 255);
        data[i * 4 + 1] = Math.round(c.g * 255);
        data[i * 4 + 2] = Math.round(c.b * 255);
        data[i * 4 + 3] = 255;
    }
    lutTex.needsUpdate = true;
    const light = isLightGround(map.ground);
    edges.material.color.set(light ? 0x000000 : 0xffffff);
    marker.material.color.set(light ? 0x111111 : 0xffffff);
    /* The screen, if one is on: its method, its pitch, its ink and ground. */
    for (const m of [body.material, cut.material]) syncHalftoneUniforms(m, renderer.getPixelRatio());
}

/** The body's own two numbers, straight to the shader. */
export function restyleBody() {
    if (!body) return;
    body.material.uniforms.uDensity.value = tetradDensity;
    body.material.uniforms.uFocus.value = tetradFocus;
}

/* ---------------------------------------------------------------------
 *  The cut
 * ------------------------------------------------------------------ */

/** Move the section to where the axis and position say — three vertices. */
export function updateSlice() {
    if (!group) return;
    const tri = sliceTriangle(tetradAxis, tetradPosition);
    const p = tri.map((b) => baryToLocal(b.u, b.v, b.w));
    const a = cut.geometry.attributes.position;
    for (let i = 0; i < 3; i++) a.setXYZ(i, p[i].x, p[i].y, p[i].z);
    a.needsUpdate = true;
    cut.geometry.computeBoundingSphere();
    cut.geometry.computeBoundingBox();
    const plane = slicePlane(tetradAxis, tetradPosition);
    body.material.uniforms.uCut.value.set(plane.n[0], plane.n[1], plane.n[2], plane.d);
    syncVisibility();
}

export function syncVisibility() {
    if (!group) return;
    const showCut = ready && tetradSlice;
    const showBody = ready && tetradVolume;
    cut.visible = showCut;
    body.visible = showBody;
    edges.visible = showCut && !showBody;
    body.material.uniforms.uCutOn.value = showCut ? 1 : 0;
    if (!ready) marker.visible = false;
}

/* ---------------------------------------------------------------------
 *  Every frame
 * ------------------------------------------------------------------ */

const camWorld = new THREE.Vector3();
let sweepDir = 1;
let lastFrameAt = 0;

/**
 * What has to be told to the shader per frame: where the eye is in the
 * shape's own space — which changes when the shape turns as much as when
 * the camera moves — and, if it is sweeping, where the cut has got to.
 */
export function frameField() {
    if (!group || !ready) return;
    const now = performance.now();
    /* Real elapsed time, clamped: a sweep paced by the frame count would run
       at whatever rate the machine happened to draw at, and a tab coming
       back from the background would leap. */
    const dt = lastFrameAt ? Math.min(0.1, (now - lastFrameAt) / 1000) : 1 / 60;
    lastFrameAt = now;
    scene.updateMatrixWorld(true);
    camera.getWorldPosition(camWorld);
    group.worldToLocal(camWorld);
    body.material.uniforms.uCam.value.copy(camWorld);

    if (tetradSweep && tetradSlice) {
        /* A full pass in about eight seconds, and back — slow enough to read
           the sections as they go by. */
        let t = tetradPosition + sweepDir * dt / 8;
        if (t >= 1) { t = 1; sweepDir = -1; }
        if (t <= 0) { t = 0; sweepDir = 1; }
        setTetradPosition(t);
        updateSlice();
        onSweep?.(t);
    }

    if (cursor.live) {
        const E = equaveCents(getOpts ? getOpts().equaveRatio : 2);
        const b = centsToBary(cursor.c1, cursor.c2, cursor.c3, E);
        marker.position.copy(baryToLocal(b.u, b.v, b.w));
        marker.visible = true;
    } else {
        marker.visible = false;
    }
}

/* ---------------------------------------------------------------------
 *  The gesture
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** Whether a cut is being played — the sprite hover stands down meanwhile. */
export function fieldDragging() { return dragging; }

function bindPointer() {
    const el = renderer.domElement;

    el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        if (!(ev.shiftKey || isClickPlayModeActive)) return;   // a plain drag orbits
        if (!ready || !tetradSlice) return;
        const hit = pick(ev);
        if (!hit) return;
        /* OrbitControls has already seen this press: it has to be switched
           off, or the shape turns under the chord being played. */
        if (controls) controls.enabled = false;
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
        if (controls) controls.enabled = !isClickPlayModeActive;
        try { if (ev.pointerId !== undefined) el.releasePointerCapture(ev.pointerId); } catch (e) {}
        onGesture?.('up', null);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    /* Letting go of Shift while still dragging ends the note, as it does on
       the triangle. */
    window.addEventListener('keyup', (ev) => {
        if (ev.key === 'Shift' && dragging && !isClickPlayModeActive) up({ pointerId: undefined });
    });
}

/**
 * The tetrad under the pointer, on the cut.
 *
 * The ray is intersected with the section's own triangle and the hit brought
 * back into the shape's frame — the scene may have been turned — and read as
 * three intervals through the same matrix the shader uses. Snapping, if on,
 * lands on the nearest just tetrad of the current set within the tolerance,
 * measured in cents in interval space.
 */
function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(cut, false);
    if (!hits.length) return null;
    const p = hits[0].point.clone();
    group.worldToLocal(p);

    const o = getOpts ? getOpts() : { equaveRatio: 2, tetrads: [] };
    const E = equaveCents(o.equaveRatio);
    const b = clampBary(localToBary(p));
    const c = baryToCents(b, E);

    if (tetradSnap > 0 && o.tetrads && o.tetrads.length) {
        let best = null, bestD = tetradSnap;
        for (const t of o.tetrads) {
            const d = Math.sqrt((t.c1 - c.c1) ** 2 + (t.c2 - c.c2) ** 2 + (t.c3 - c.c3) ** 2);
            if (d <= bestD) { bestD = d; best = t; }
        }
        if (best) return { c1: best.c1, c2: best.c2, c3: best.c3, label: best.label, snapped: true };
    }
    return { c1: c.c1, c2: c.c2, c3: c.c3, label: null, snapped: false };
}

/** The entropy at a chord, 0..1 with 1 the most concordant — for the foot. */
export function concordanceAt(c1, c2, c3, E) {
    const vol = currentVolume();
    if (!vol) return NaN;
    const b = centsToBary(c1, c2, c3, E);
    return normaliseVolume(vol, sampleVolume(vol, b.u, b.v, b.w));
}
