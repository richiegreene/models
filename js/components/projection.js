/* =====================================================================
 *  PERSPECTIVE OR ORTHOGRAPHIC — how the 3D panes are projected
 * =====================================================================
 *
 * One setting for both 3D views, the tetrahedron and the triangle's lifted
 * surface, under Display › Visuals. Dyads has no 3D view and no switch.
 *
 * Perspective is how an eye sees it: nearer is bigger, and parallel edges
 * run together into the distance. Orthographic is how a drawing is made:
 * every point is carried straight onto the screen, so parallel edges stay
 * parallel and the same length measures the same at any depth — the shape's
 * proportions are read off it undistorted by where each part happens to sit.
 *
 * KEYBOARD DESIGNER'S FRAMING.  The orthographic view is sized from the same
 * field of view at the distance the camera is from what it orbits: the plane
 * through the orbit's centre is exactly as big on screen in both, so switching
 * changes the depth and not the zoom. Zooming in orthographic still moves the
 * camera in, and the frame shrinks with it, so the wheel does the same thing
 * in both.
 *
 * ONE CAMERA, A DIFFERENT MATRIX.  The camera is not swapped for an
 * OrthographicCamera. Everything that already reads it — its field of view,
 * its distance, the controls' dolly, the fit, the export — keeps working on
 * the camera it always had; only its projection matrix changes, and the flag
 * three's lighting reads to know rays are parallel. The one thing three gets
 * wrong for such a camera is the picking ray, which `rayFrom` builds instead.
 * ------------------------------------------------------------------ */

let mode = 'persp';   // 'persp' | 'orth'

/** The cameras that follow the setting, and how far each is from its centre. */
const live = new Map();   // camera → () => distance

export function projectionMode() { return mode; }
export function isOrtho() { return mode === 'orth'; }

/** Switch, and re-project every camera that follows it at once. */
export function setProjection(next) {
    mode = next === 'orth' ? 'orth' : 'persp';
    for (const cam of live.keys()) cam.updateProjectionMatrix();
}

/**
 * Give a camera the chosen projection, framed `distance` from its centre.
 * Called after the camera's own perspective update; in perspective there is
 * nothing to add. Exported for a scratch camera that does not follow the
 * setting by itself — the triangle's fit solves against one.
 */
export function applyProjection(cam, distance) {
    if (mode !== 'orth') { cam.isOrthographicCamera = false; return; }
    const halfH = Math.max(1e-6, distance) * Math.tan((cam.fov * Math.PI) / 360) / (cam.zoom || 1);
    const halfW = halfH * cam.aspect;
    cam.projectionMatrix.makeOrthographic(-halfW, halfW, halfH, -halfH, cam.near, cam.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.isOrthographicCamera = true;
}

/**
 * Make a perspective camera follow the setting through every update of its
 * projection — the resize handlers, the fit, the export's tight crop — so no
 * caller has to know which projection is up. `distanceOf` says how far the
 * camera is from what it orbits, read fresh each time.
 */
export function followProjection(cam, distanceOf) {
    const perspective = cam.updateProjectionMatrix;
    cam.updateProjectionMatrix = function () {
        perspective.call(this);
        applyProjection(this, distanceOf());
    };
    live.set(cam, distanceOf);
    cam.updateProjectionMatrix();
}

/**
 * Once a frame, before the render: an orthographic frame is sized from the
 * camera's distance, and the wheel changes the distance without asking for a
 * new projection. Perspective needs nothing.
 */
export function refreshProjection(cam) {
    if (mode === 'orth') cam.updateProjectionMatrix();
}

/**
 * The picking ray through a point of the screen. three builds a perspective
 * ray for any camera that calls itself one, which this one still does; in
 * orthographic every ray is parallel, starting on the near plane under the
 * pointer.
 */
export function rayFrom(raycaster, ndc, cam) {
    if (!cam.isOrthographicCamera) {
        raycaster.setFromCamera(ndc, cam);
        return;
    }
    raycaster.ray.origin.set(ndc.x, ndc.y, -1).unproject(cam);
    raycaster.ray.direction.set(0, 0, -1).transformDirection(cam.matrixWorld);
    raycaster.camera = cam;
}
