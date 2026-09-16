import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.126.0/examples/jsm/controls/OrbitControls.js';

import { 
    scene, camera, renderer, controls,
    currentSprites, currentLayoutDisplay, rotationSpeed, setRotationSpeed,
    keyState, isShiftHeld, isClickPlayModeActive, currentlyHovered,
    playButton, pivotButtons, currentPivotVoiceIndex,
    setScene, setCamera, setRenderer, setControls,
    setCurrentSprites, setIsShiftHeld, setIsClickPlayModeActive, setCurrentlyHovered,
    setCurrentPivotVoiceIndex, setKeyState,
    mpePressure, mpePressureRampSpeed, mpePressureIntervalTime, mpePressureIntervalId,
    setMpePressure, setMpePressureRampSpeed, setMpePressureIntervalTime, setMpePressureIntervalId,
    autoRotate, autoRotateDir, setAutoRotateDir
} from '../globals.js';

import { appMode } from '../app-mode.js';
import { initAudio, stopChord, playChord } from '../components/audio-engine.js';
import { sendMpePressure, mpeChannels } from '../midi/midi-output.js';
import { updateMpePressureSliderUI } from '../utils/ui-handlers.js';

/* ---- what the entropy field asks of this scene ----
   The field is drawn into this scene and played on this canvas, but it is
   the tetrad modules' own business; rather than this file importing them (and
   them importing this file's transform, which would be a cycle) they hand
   in the two things they need: a hook run every frame before the render,
   and a guard that says a cut is being played so the sprite hover stands
   down. See initTetrads in tetrad-mode.js. */
const frameHooks = [];
let hoverGuard = () => false;
export function addFrameHook(fn) { frameHooks.push(fn); }
export function setHoverGuard(fn) { hoverGuard = fn; }

// Create a circular texture for points
function createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.beginPath();
    context.arc(32, 32, 30, 0, Math.PI * 2, false);
    context.fillStyle = 'white';
    context.fill();
    return new THREE.CanvasTexture(canvas);
}
const circleTexture = createCircleTexture();

export function makeTextSprite(message, parameters) {
    if ( parameters === undefined ) parameters = {};
    const fontface = parameters.hasOwnProperty("fontface") ? parameters["fontface"] : "monospace";
    const fontsize = parameters.hasOwnProperty("fontsize") ? parameters["fontsize"] : 40;
    const borderThickness = 0; // No border
    const textColor = parameters.hasOwnProperty("textColor") ? parameters["textColor"] : { r:255, g:255, b:255, a:1.0 };

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = fontsize + "px " + fontface; // Removed "Bold "

    const metrics = context.measureText( message );
    const textWidth = metrics.width;

    canvas.width = textWidth + borderThickness * 2;
    canvas.height = fontsize * 1.4 + borderThickness * 2;

    context.font = fontsize + "px " + fontface; // Removed "Bold "
    context.textAlign = "center";
    context.textBaseline = "middle";

    context.fillStyle = "rgba(" + textColor.r + ", " + textColor.g + ", " + textColor.b + ", 1.0)";
    context.fillText( message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.Texture(canvas) 
    texture.needsUpdate = true;

    const spriteMaterial = new THREE.SpriteMaterial( { map: texture } );
    const sprite = new THREE.Sprite( spriteMaterial );
    sprite.scale.set(canvas.width / fontsize, canvas.height / fontsize, 1.0); // Adjust scale based on canvas size, more neutral
    sprite.userData.textColor = textColor; // Store for SVG export
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;  
}

// Function to create a circular point sprite
export function makePointSprite(color, opacity) {
    const spriteMaterial = new THREE.SpriteMaterial({
        map: circleTexture,
        color: color,
        transparent: true,
        opacity: opacity,
        alphaTest: 0.1 // Use alphaTest for transparency
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    return sprite;
}

export function updatePivotButtonSelection(selectedIndex) {
    // Assuming pivotButtons is accessible globally or passed in
    const pivotButtonsElements = document.querySelectorAll('.pivot-button'); // Re-query or pass as arg
    if (!pivotButtonsElements) return; // Ensure buttons are initialized

    pivotButtonsElements.forEach(button => {
        if (parseInt(button.dataset.pivotIndex) === selectedIndex) {
            button.classList.add('on');
        } else {
            button.classList.remove('on');
        }
    });
    setCurrentPivotVoiceIndex(selectedIndex); 
}

// Transformation function for an apex-up regular tetrahedron
export function transformToRegularTetrahedron(c1, c2, c3, max_val) {
    const u = c1 / max_val;
    const v = c2 / max_val;
    const w = c3 / max_val;

    const side_length = 3.0;
    const L = side_length;

    const h_apex = L * Math.sqrt(2/3);
    const r_base = L * Math.sqrt(3)/3;
    
    const T_apex = new THREE.Vector3(0, 0, h_apex);
    const T_base1 = new THREE.Vector3(r_base, 0, 0); 
    const T_base2 = new THREE.Vector3(r_base * Math.cos(2*Math.PI/3), r_base * Math.sin(2*Math.PI/3), 0);
    const T_base3 = new THREE.Vector3(r_base * Math.cos(4*Math.PI/3), r_base * Math.sin(4*Math.PI/3), 0);

    const a0 = 1 - u - v - w;
    const a1 = u;
    const a2 = v;
    const a3 = w;

    const x_transformed = a0 * T_apex.x + a1 * T_base1.x + a2 * T_base2.x + a3 * T_base3.x;
    const y_transformed = a0 * T_apex.y + a1 * T_base1.y + a2 * T_base2.y + a3 * T_base3.y;
    const z_transformed = a0 * T_apex.z + a1 * T_base1.z + a2 * T_base2.z + a3 * T_base3.z;
    
    const overall_vertical_offset = -h_apex / 2; 

    return [x_transformed, y_transformed, z_transformed + overall_vertical_offset];
}

// --- MPE Pressure Ramping Functions ---
function startRampingPressureUp() {
    if (mpePressureIntervalId !== null) return; // Already ramping
    setMpePressureIntervalId(setInterval(() => {
        setMpePressure(Math.min(127, mpePressure + mpePressureRampSpeed));
        mpeChannels.forEach(channel => {
            sendMpePressure(channel, mpePressure);
        });
        updateMpePressureSliderUI(); // Update the UI slider
    }, mpePressureIntervalTime));
}

function startRampingPressureDown() {
    if (mpePressureIntervalId !== null) return; // Already ramping
    setMpePressureIntervalId(setInterval(() => {
        setMpePressure(Math.max(0, mpePressure - mpePressureRampSpeed));
        mpeChannels.forEach(channel => {
            sendMpePressure(channel, mpePressure);
        });
        updateMpePressureSliderUI(); // Update the UI slider
    }, mpePressureIntervalTime));
}

function stopRampingPressure() {
    if (mpePressureIntervalId !== null) {
        clearInterval(mpePressureIntervalId);
        setMpePressureIntervalId(null);
    }
}

// --- Event Handlers for Three.js Interactions ---
function onKeyDown(event) {
    const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    /* S/A/T/B name four voices and Shift sounds the corner under the pointer:
       both are statements about a tetrad, and in Triads mode there is none.
       The rotation keys are let through — Motion is shared, and steers
       whichever scene is up. */
    if (appMode !== 'tetrads' && !arrowKeys.includes(event.key)
        && !'[]{}'.includes(event.key)) return;

    /* While it is spinning, an arrow steers rather than nudges: the shape is
     * already turning, so a press that also shoved it would read as a stutter
     * rather than as a change of direction. Taken here and gone no further,
     * which is what keeps keyState from turning it twice in one frame. */
    if (autoRotate && arrowKeys.includes(event.key)) {
        setAutoRotateDir(event.key);
        arrowKeys.forEach(key => setKeyState(key, false));
        event.preventDefault();
        return;
    }

    if (event.key === 'Shift' && !isShiftHeld) {
        initAudio();
        setIsShiftHeld(true);
        if (controls) controls.enablePan = false;
        const playButtonElement = document.getElementById('playButton'); 
        if (playButtonElement) playButtonElement.classList.add('play-button-active');
        stopChord(); 
    } else if (['S', 'A', 'T', 'B'].includes(event.key.toUpperCase())) {
        let selectedIndex;
        switch (event.key.toUpperCase()) {
            case 'S': selectedIndex = 3; break;
            case 'A': selectedIndex = 2; break;
            case 'T': selectedIndex = 1; break;
            case 'B': selectedIndex = 0; break;
            default: return;
        }
        updatePivotButtonSelection(selectedIndex);
        event.preventDefault(); 
    } else if (event.key === '=' || event.key === '+' || event.key === '@') { // Keys for increasing pressure
        startRampingPressureUp();
        event.preventDefault();
    } else if (event.key === '-' || event.key === '_' || event.key === '!') { // Keys for decreasing pressure
        startRampingPressureDown();
        event.preventDefault();
    } else if (event.key === ']' || event.key === '}') { // Speed up rotation
        setRotationSpeed(Math.min(20 * Math.PI / (180 * 60), rotationSpeed * 1.1)); // Increase speed by 10%, max 20deg/s
        event.preventDefault();
    } else if (event.key === '[' || event.key === '{') { // Slow down rotation
        setRotationSpeed(Math.max(0.5 * Math.PI / (180 * 60), rotationSpeed * 0.9)); // Decrease speed by 10%, min 0.5deg/s
        event.preventDefault();
    }

    if (keyState.hasOwnProperty(event.key)) {
        setKeyState(event.key, true);
        event.preventDefault();
    }
}

function onKeyUp(event) {
    if (appMode !== 'tetrads' && !keyState.hasOwnProperty(event.key)) return;
    if (event.key === 'Shift') {
        setIsShiftHeld(false);
        const playButtonElement = document.getElementById('playButton'); 
        if (!isClickPlayModeActive) { 
            if (controls) controls.enablePan = true;
            if (playButtonElement) playButtonElement.classList.remove('play-button-active');
        } else {
        }
        stopChord(); 
        setCurrentlyHovered(null); 
    } else if (event.key === '=' || event.key === '+' || event.key === '-' || event.key === '_' || event.key === '1' || event.key === '!' || event.key === '2' || event.key === '@') {
        stopRampingPressure();
        event.preventDefault();
    }
    
    if (keyState.hasOwnProperty(event.key)) {
        setKeyState(event.key, false);
        event.preventDefault();
    }
}

function onMouseMove(event) {
    if (appMode !== 'tetrads') return;
    if (hoverGuard()) return;
    if (!isShiftHeld) {
        if (currentlyHovered) {
            stopChord();
            setCurrentlyHovered(null);
        }
        return;
    }

    initAudio();

    const mouse = new THREE.Vector2();
    const canvasBounds = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
    mouse.y = -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(currentSprites);

    if (intersects.length > 0) {
        const firstHit = intersects[0].object;
        if (currentlyHovered !== firstHit) {
            if (firstHit.userData.ratio) {
                setCurrentlyHovered(firstHit);
                playChord(firstHit.userData.ratio);
            }
        }
    } else {
        if (currentlyHovered) {
            stopChord();
            setCurrentlyHovered(null);
        }
    }
}

function onClick(event) {
    if (appMode !== 'tetrads') return;
    if (hoverGuard()) return;
    if (!isClickPlayModeActive) {
        return;
    }

    if (isShiftHeld) {
        return;
    }

    initAudio();

    const mouse = new THREE.Vector2();
    const canvasBounds = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
    mouse.y = -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(currentSprites);

    if (intersects.length > 0) {
        const firstHit = intersects[0].object;
        if (firstHit.userData.ratio) {
            playChord(firstHit.userData.ratio);
        }
    } else {
        stopChord(); 
    }
}


export function initThreeJS() {
    const container = document.getElementById('container');
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    setScene(new THREE.Scene());
    scene.background = new THREE.Color(0x000000);

    setCamera(new THREE.PerspectiveCamera(75, (container.clientWidth || 1) / (container.clientHeight || 1), 0.1, 1000));
    camera.position.set(0, 3, 6);
    camera.lookAt(0, 0, 0);

    setRenderer(new THREE.WebGLRenderer({ antialias: true }));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    container.appendChild(renderer.domElement);

    setControls(new OrbitControls(camera, renderer.domElement));
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 30;

    window.addEventListener('keydown', onKeyDown, false);
    window.addEventListener('keyup', onKeyUp, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('click', onClick, false); 
    window.addEventListener('resize', onWindowResize, false);
    new ResizeObserver(onWindowResize).observe(container);
}

/* The viewport is no longer the window: the panel takes width from it, and
   opening or shutting the panel resizes it without the window changing at
   all. So the size is read off #container, and initThreeJS puts a
   ResizeObserver on it rather than relying on the window's own event. */
export function onWindowResize() {
    const container = document.getElementById('container');
    if (!camera || !renderer || !container) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

export function animate() {
    requestAnimationFrame(animate);

    /* The tetrahedron keeps its own loop, but not its own claim on the GPU:
       while Triads is up this scene is not on screen, and rendering it anyway
       would mean two WebGL contexts drawing every frame for one visible
       picture. The loop stays alive so that switching back is instant. */
    if (appMode !== 'tetrads') return;

    if (controls) controls.update();

    /* One rate for both, so the Motion readout means the same thing whether
     * you are holding an arrow or watching it spin: at the default it is a
     * turn every eleven seconds, which is a turntable. The old continuous
     * mode ran at an eighth of the nudge rate, and the number under the
     * slider was therefore true of neither. */
    const turn = autoRotate ? autoRotateDir
        : keyState.ArrowUp ? 'ArrowUp' : keyState.ArrowDown ? 'ArrowDown'
        : keyState.ArrowLeft ? 'ArrowLeft' : keyState.ArrowRight ? 'ArrowRight' : null;

    if (scene && turn) {
        if (turn === 'ArrowUp') scene.rotation.x -= rotationSpeed;
        else if (turn === 'ArrowDown') scene.rotation.x += rotationSpeed;
        else if (turn === 'ArrowLeft') scene.rotation.y -= rotationSpeed;
        else scene.rotation.y += rotationSpeed;
    }

    if (currentLayoutDisplay === 'labels' || currentLayoutDisplay === 'points') {
        const spriteWorldPosition = new THREE.Vector3();
        currentSprites.forEach(sprite => {
            sprite.getWorldPosition(spriteWorldPosition);
            const distance = camera.position.distanceTo(spriteWorldPosition);
            let currentSpriteSize;

            if (sprite.userData.type === 'label') {
                if (sprite.userData.enableSize) {
                    const baseScreenSize = sprite.userData.baseSize * 0.5;
                    const scaledSize = baseScreenSize + (sprite.userData.normalizedComplexity * baseScreenSize * (sprite.userData.scalingFactor - 1));
                    currentSpriteSize = Math.max(baseScreenSize, scaledSize);
                } else {
                    currentSpriteSize = sprite.userData.baseSize * 0.5;
                }
                const finalSize = currentSpriteSize * distance;
                sprite.scale.set(finalSize * sprite.userData.aspect, finalSize, 1);
            } else if (sprite.userData.type === 'point') {
                if (sprite.userData.enableSize) {
                    const baseScreenSize = sprite.userData.baseSize * 0.01;
                    const scaledSize = baseScreenSize + (sprite.userData.normalizedComplexity * baseScreenSize * (sprite.userData.scalingFactor - 1));
                    currentSpriteSize = Math.max(baseScreenSize, scaledSize);
                } else {
                    currentSpriteSize = sprite.userData.baseSize * 0.01;
                }
                const finalSize = currentSpriteSize * distance;
                sprite.scale.set(finalSize, finalSize, 1);
            }
        });
    }

    for (const hook of frameHooks) hook();

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}