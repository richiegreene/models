/* =====================================================================
 *  OUTLINE — line art over the 3D panes
 * =====================================================================
 *
 * Blender's Line Art, for the two 3D views: a layer of strokes laid over the
 * picture wherever a shape has an edge, so that a hill reads as a hill by its
 * drawn outline the way it would in a pen drawing of it, and not only by its
 * shading. One setting, under Display › Visuals, for the tetrahedron and the
 * triangle's lifted surface alike; the flat panes are drawings already.
 *
 * WHAT COUNTS AS AN EDGE.  Line Art's own three, found in the picture rather
 * than in the mesh:
 *
 *   silhouette    where a shape ends and the ground begins
 *   occlusion     where one part of a shape passes in front of another — the
 *                 near flank of a summit against the slope behind it, which
 *                 is the line that makes a range of hills read as a range
 *   crease        where the surface folds sharply without anything being
 *                 hidden — a ridge seen from above
 *
 * and where two different things meet, as Line Art's intersections: the cut
 * through the tetrahedron where it slices a well of the body.
 *
 * HOW.  The scene is drawn a second time into a buffer of its own, every
 * shape in it painted with its surface normal, its depth and a number saying
 * which object it is — nothing else, no lattice, no labels, no light. The
 * edges are read off that buffer a pixel wide; they are then thickened to the
 * slider's width by a jump flood, which finds for every pixel the nearest
 * edge in a handful of passes however wide the stroke, so a stroke is round
 * and its weight is the edge's own: full along a silhouette, swelling and
 * tapering along an occlusion as it deepens and fades. Last, the strokes are
 * put over the picture, at the depth of what they outline — so a dot or a
 * label lying in front of a hill is not drawn over by the hill's outline. A
 * shape that is itself drawn over everything, the way the body's haze is, has
 * its outline drawn over everything too.
 *
 * WHAT IS OUTLINED.  Surfaces and volumes: the lifted field, the plate, the
 * cut, and the tetrahedron's body. The body is not a surface at all, so it
 * says what its outline is itself, through `userData.ink` — see the body's
 * ink shader in tetrad-field.js, which takes the surface of each well to be
 * where a well's width of the body would be half opaque. The marks — dots,
 * labels, contour lines, the cursor bead — are left out: they are already
 * drawings.
 *
 * WebGL2, like the tetrahedron's field: the edges are read with texelFetch
 * from a float depth buffer. Where there is no WebGL2 there is no outline.
 * ------------------------------------------------------------------ */

import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';

/**
 * What the panel is set to. Shared by both 3D views, like the halftone:
 * `ink` is 'off' or the colour the strokes are drawn in, `width` the stroke's
 * thickness in CSS pixels.
 */
export const outline = { ink: 'off', width: 3 };

export function outlineOn() { return outline.ink !== 'off'; }

const INKS = { black: [0, 0, 0], white: [1, 1, 1] };

/* ---- what counts as an edge ----
   The numbers that decide it, named because they are the ones that want
   nudging by eye. */

/** How far behind its neighbours a pixel must fall, as a fraction of its own
 *  distance, before the step is an occlusion rather than a slope. Measured
 *  against the plane through its neighbours, so a surface seen at a grazing
 *  angle is not mistaken for a cliff. A line is drawn at half its weight at
 *  this step, comes in from nothing at half of it and is at full weight by
 *  half again — so where a summit stops hiding the slope behind it, its
 *  outline tapers away like a pen lifting off rather than stopping dead. */
const JUMP = 0.004;

/** How sharply the surface must fold, between one pixel and the next, to be
 *  drawn as a crease: coming in at 30° off flat, full at 50°, so that half
 *  weight is Line Art's own default of 40°. */
const CREASE = [Math.cos(50 * Math.PI / 180), Math.cos(30 * Math.PI / 180)];

/** How far in front of what it outlines a stroke is placed, as a fraction of
 *  its distance — enough that a surface does not hide its own outline, and
 *  well under the lift that puts a dot above the surface it marks. */
const PULL = 0.002;

/* ---------------------------------------------------------------------
 *  The shaders
 * ------------------------------------------------------------------ */

/* The ink pass: each shape painted with its normal, facing the eye, in view
   space, and with which object it is. A shape without normals of its own —
   the cut, a flat triangle — is given its facet's, from the derivatives. */
const INK_VERT = /* glsl */`
out vec3 vView;
out vec3 vNormal;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = mv.xyz;
#ifdef HAS_NORMAL
    vNormal = normalMatrix * normal;
#else
    vNormal = vec3(0.0);
#endif
    gl_Position = projectionMatrix * mv;
}`;

const INK_FRAG = /* glsl */`
uniform float uInkId;
in vec3 vView;
in vec3 vNormal;
out vec4 outColor;
void main() {
#ifdef HAS_NORMAL
    vec3 n = normalize(vNormal);
#else
    vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
#endif
    vec3 toEye = isOrthographic ? vec3(0.0, 0.0, 1.0) : -vView;
    if (dot(n, toEye) < 0.0) n = -n;
    outColor = vec4(n * 0.5 + 0.5, uInkId);
}`;

const QUAD_VERT = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* What every full-screen pass shares: reading a pixel exactly, and a jump
   flood's entry — the offset to the nearest edge, in pixels, packed into a
   byte each about 127; whether there is one at all; and how strong that
   edge is, 0 to 1, which is how much of the stroke's width it is drawn at. */
const PX = /* glsl */`
precision highp sampler2D;
uniform ivec2 uSize;
out vec4 outColor;
ivec2 clampPx(ivec2 p) { return clamp(p, ivec2(0), uSize - 1); }
vec4 pack(ivec2 o, float s) { return vec4((vec2(o) + 127.0) / 255.0, 1.0, s); }
ivec2 unpack(vec4 e) { return ivec2(floor(e.rg * 255.0 + 0.5)) - 127; }
`;

/* The edges, a pixel wide, each with its strength. Every test is one-sided,
   so a line is laid on one side of what it marks rather than on both: the
   NEAR side of an occlusion, which is what the stroke's depth is then read
   from. A silhouette, and one thing meeting another, are always at full
   strength; an occlusion and a fold are as strong as they are steep. */
const SEED_FRAG = PX + /* glsl */`
uniform sampler2D uInk;
uniform sampler2D uDepth;
uniform mat4 uProjInv;
uniform float uJump;
uniform vec2 uCrease;

vec4 inkAt(ivec2 p) { return texelFetch(uInk, clampPx(p), 0); }
float depthAt(ivec2 p) { return texelFetch(uDepth, clampPx(p), 0).r; }
float idOf(vec4 s) { return floor(s.a * 255.0 + 0.5); }

/* How far from the eye a pixel's depth is, along the view. */
float viewDepth(ivec2 p, float d) {
    vec2 ndc = (vec2(p) + 0.5) / vec2(uSize) * 2.0 - 1.0;
    vec4 v = uProjInv * vec4(ndc, d * 2.0 - 1.0, 1.0);
    return -v.z / v.w;
}

/* The buffer's depth is linear across the screen over any flat piece of
   surface, in either projection, so the second difference along a row is
   zero on a plane at any angle and is exactly the step where one thing
   passes behind another. Positive is this pixel standing in front. */
float occlusion(ivec2 p, float d, float lap) {
    if (lap <= 0.0) return 0.0;
    float z0 = viewDepth(p, d);
    float step = (viewDepth(p, min(1.0, d + lap)) - z0) / z0;
    return smoothstep(0.5 * uJump, 1.5 * uJump, step);
}

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    outColor = vec4(0.0);
    vec4 c = inkAt(p);
    float id = idOf(c);
    if (id < 0.5) return;
    vec3 n = c.rgb * 2.0 - 1.0;
    float d = depthAt(p);

    ivec2 off[4] = ivec2[4](ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
    float dn[4];
    float edge = 0.0;
    for (int i = 0; i < 4; i++) {
        ivec2 q = p + off[i];
        vec4 s = texelFetch(uInk, clampPx(q), 0);
        float sid = idOf(s);
        dn[i] = depthAt(q);
        if (sid < 0.5) { edge = 1.0; continue; }                  // against the ground
        if (sid != id) { if (d <= dn[i]) edge = 1.0; continue; }  // one thing meeting another
        if (i == 0 || i == 2) {                                   // a fold
            edge = max(edge, 1.0 - smoothstep(uCrease.x, uCrease.y, dot(n, s.rgb * 2.0 - 1.0)));
        }
    }
    edge = max(edge, occlusion(p, d, dn[0] + dn[1] - 2.0 * d));
    edge = max(edge, occlusion(p, d, dn[2] + dn[3] - 2.0 * d));
    if (edge > 0.0) outColor = pack(ivec2(0), edge);
}`;

/* One step of the flood: of the nine entries a step apart, keep whichever
   edge this pixel lies deepest inside the stroke of — the nearest, counting
   a strong edge's stroke as reaching further than a weak one's, so a fading
   line never cuts a notch in a full one beside it. Anything the stroke cannot
   reach is dropped, which also keeps every offset inside its byte. */
const JFA_FRAG = PX + /* glsl */`
uniform sampler2D uPrev;
uniform int uStep;
uniform float uRadius;
uniform float uReach;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float best = 1e9, bestS = 0.0;
    ivec2 bestOff = ivec2(0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            ivec2 q = p + ivec2(i, j) * uStep;
            if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, uSize))) continue;
            vec4 e = texelFetch(uPrev, q, 0);
            if (e.b < 0.5) continue;
            ivec2 o = q + unpack(e) - p;
            float dist = length(vec2(o));
            float score = dist - uRadius * e.a;
            if (dist <= uReach && score < best) { best = score; bestS = e.a; bestOff = o; }
        }
    }
    outColor = best < 0.5 ? pack(bestOff, bestS) : vec4(0.0);
}`;

/* The stroke itself: inked as far out from its edge as the slider says —
   times the edge's strength, and fainter too where it is faint — with a
   pixel of soft edge, at the depth of the nearer of what it outlines and
   what it lies over — pulled a hair toward the eye — so the picture's own
   depth decides what covers it. An edge of something drawn in front of
   everything is put in front of everything. */
const STROKE_FRAG = PX + /* glsl */`
uniform sampler2D uFlood;
uniform sampler2D uInk;
uniform sampler2D uDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform float uRadius;
uniform float uPull;
uniform vec3 uColor;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 e = texelFetch(uFlood, p, 0);
    if (e.b < 0.5) discard;
    ivec2 o = unpack(e);
    float cover = clamp(uRadius * e.a - length(vec2(o)) + 0.5, 0.0, 1.0) * min(1.0, 2.0 * e.a);
    if (cover <= 0.0) discard;

    ivec2 s = clampPx(p + o);
    if (texelFetch(uInk, s, 0).a * 255.0 > 127.5) {
        gl_FragDepth = 0.0;
        outColor = vec4(uColor, cover);
        return;
    }
    float d = min(texelFetch(uDepth, s, 0).r, texelFetch(uDepth, p, 0).r);
    vec2 ndc = (vec2(p) + 0.5) / vec2(uSize) * 2.0 - 1.0;
    vec4 v = uProjInv * vec4(ndc, d * 2.0 - 1.0, 1.0);
    v /= v.w;
    v.z *= 1.0 - uPull;
    vec4 clip = uProj * v;
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
    outColor = vec4(uColor, cover);
}`;

/* ---------------------------------------------------------------------
 *  One kit per renderer
 *
 *  Every GL resource belongs to one context, and the two 3D panes are two
 *  contexts, so each renderer gets its own buffers and passes the first time
 *  it is outlined.
 * ------------------------------------------------------------------ */

const kits = new WeakMap();

function makeKit() {
    const quadPass = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: QUAD_VERT,
        fragmentShader,
        uniforms: { uSize: { value: new Int32Array(2) }, ...uniforms },
        depthTest: false,
        depthWrite: false,
        ...extra,
    });

    const seed = quadPass(SEED_FRAG, {
        uInk: { value: null },
        uDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uJump: { value: JUMP },
        uCrease: { value: new THREE.Vector2(...CREASE) },
    });
    const flood = quadPass(JFA_FRAG, {
        uPrev: { value: null },
        uStep: { value: 1 },
        uRadius: { value: 1 },
        uReach: { value: 1 },
    });
    const stroke = quadPass(STROKE_FRAG, {
        uFlood: { value: null },
        uInk: { value: null },
        uDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uProjInv: { value: new THREE.Matrix4() },
        uRadius: { value: 1 },
        uPull: { value: PULL },
        uColor: { value: new THREE.Vector3() },
    }, {
        /* Tested against the picture's own depth, still in the canvas from
           the render just made, and never written to it. */
        depthTest: true,
        transparent: true,
        blending: THREE.NormalBlending,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), seed);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);

    return {
        seed, flood, stroke, quad, quadScene,
        quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
        size: new THREE.Vector2(),
        clearColor: new THREE.Color(),
        targets: null,
        /* Each outlined object's own ink material, so that each can carry
           its own number — three uploads a material's uniforms once per
           render call, and a shared one would paint every object alike. */
        inks: new WeakMap(),
    };
}

function sizeTargets(kit, w, h) {
    if (kit.targets && kit.targets.w === w && kit.targets.h === h) return;
    if (kit.targets) {
        kit.targets.ink.depthTexture.dispose();
        for (const t of [kit.targets.ink, kit.targets.a, kit.targets.b]) t.dispose();
    }
    const opts = {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        generateMipmaps: false,
        stencilBuffer: false,
    };
    const ink = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true });
    ink.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    kit.targets = {
        w, h, ink,
        a: new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: false }),
        b: new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: false }),
    };
}

/** The material an object is outlined through, or null if it is not. */
function inkFor(kit, obj) {
    const own = obj.userData.ink;
    if (own === false) return null;
    if (own && own.isMaterial) return own;
    if (!obj.isMesh || obj.isLineSegments2 || obj.isLine2) return null;
    if (!obj.material || Array.isArray(obj.material)) return null;
    let m = kit.inks.get(obj);
    if (!m) {
        m = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: INK_VERT,
            fragmentShader: INK_FRAG,
            defines: obj.geometry && obj.geometry.attributes.normal ? { HAS_NORMAL: '' } : {},
            uniforms: { uInkId: { value: 0 } },
        });
        kit.inks.set(obj, m);
    }
    m.side = obj.material.side;
    return m;
}

/* ---------------------------------------------------------------------
 *  Drawing
 * ------------------------------------------------------------------ */

/**
 * Lay the outline over what `renderer` has just drawn of `scene`.
 *
 * Called straight after the pane's own render, with the picture and its
 * depth still in the canvas; does nothing while the outline is off. Leaves
 * the renderer as it found it.
 */
export function drawOutline(renderer, scene, camera) {
    if (!outlineOn() || !renderer || !scene || !camera) return;
    if (!renderer.capabilities || !renderer.capabilities.isWebGL2) return;

    let kit = kits.get(renderer);
    if (!kit) { kit = makeKit(); kits.set(renderer, kit); }
    renderer.getDrawingBufferSize(kit.size);
    const w = Math.max(1, Math.floor(kit.size.x)), h = Math.max(1, Math.floor(kit.size.y));
    sizeTargets(kit, w, h);
    const T = kit.targets;

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(kit.clearColor);
    const prevBackground = scene.background;

    /* ---- the ink pass ---- */
    const swapped = [];
    const hidden = [];
    let next = 0;
    scene.traverseVisible((obj) => {
        if (!(obj.isMesh || obj.isPoints || obj.isLine || obj.isSprite)) return;
        const m = inkFor(kit, obj);
        if (!m) { hidden.push(obj); return; }
        /* Numbered in the order met, 1 to 127 and round again: what matters
           is only that two things side by side are not the same number. The
           top bit says the shape is drawn over everything — no depth test —
           and its outline is to be as well. */
        const front = obj.material.depthTest === false ? 128 : 0;
        if (m.uniforms && m.uniforms.uInkId) m.uniforms.uInkId.value = (front + (next++ % 127) + 1) / 255;
        swapped.push([obj, obj.material]);
        obj.material = m;
    });
    for (const obj of hidden) obj.visible = false;

    try {
        scene.background = null;
        renderer.setClearColor(0x000000, 0);
        renderer.autoClear = true;
        renderer.setRenderTarget(T.ink);
        renderer.render(scene, camera);
    } finally {
        for (const [obj, m] of swapped) obj.material = m;
        for (const obj of hidden) obj.visible = true;
        scene.background = prevBackground;
        renderer.setClearColor(kit.clearColor, prevAlpha);
    }

    /* ---- the edges, and the flood ---- */
    renderer.autoClear = false;
    const run = (material, target) => {
        material.uniforms.uSize.value[0] = w;
        material.uniforms.uSize.value[1] = h;
        kit.quad.material = material;
        renderer.setRenderTarget(target);
        renderer.render(kit.quadScene, kit.quadCamera);
    };

    kit.seed.uniforms.uInk.value = T.ink.texture;
    kit.seed.uniforms.uDepth.value = T.ink.depthTexture;
    kit.seed.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    run(kit.seed, T.a);

    const radius = Math.min(100, Math.max(0.25, outline.width * renderer.getPixelRatio() / 2));
    const reach = Math.ceil(radius + 1);
    kit.flood.uniforms.uRadius.value = radius;
    kit.flood.uniforms.uReach.value = reach;
    let src = T.a, dst = T.b;
    for (let step = 1 << Math.floor(Math.log2(reach)); step >= 1; step >>= 1) {
        kit.flood.uniforms.uPrev.value = src.texture;
        kit.flood.uniforms.uStep.value = step;
        run(kit.flood, dst);
        [src, dst] = [dst, src];
    }

    /* ---- the strokes, over the picture ---- */
    const u = kit.stroke.uniforms;
    u.uFlood.value = src.texture;
    u.uInk.value = T.ink.texture;
    u.uDepth.value = T.ink.depthTexture;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uRadius.value = radius;
    u.uColor.value.fromArray(INKS[outline.ink] || INKS.black);
    run(kit.stroke, prevTarget);

    renderer.autoClear = prevAutoClear;
}
