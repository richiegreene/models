import * as THREE from 'https://unpkg.com/three@0.126.0/build/three.module.js';
import { camera, currentSprites, scene, renderer } from '../globals.js';
import { currentTetradSet } from '../calculations/tetrahedron-updater.js';
import { currentVolume } from '../tetrads/tetrad-volume.js';
import { tetradModel, tetradSlice, tetradVolume } from '../tetrads/tetrad-state.js';
import { equaveCents, centsToBary, sampleVolume } from '../tetrads/tetrad-geometry.js';

export function exportToSVG() {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, 'svg');
    /* The drawing is the viewport, not the window: the panel takes width from
       one and not the other, and an export sized to the window would place
       every point against a frame that is not the one on screen. */
    const view = document.getElementById('container');
    const width = (view && view.clientWidth) || window.innerWidth;
    const height = (view && view.clientHeight) || window.innerHeight;
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    const style = document.createElementNS(svgNS, 'style');
    style.textContent = `
        svg {
            background-color: ${scene.background.getStyle()};
        }
        text {
            font-family: monospace;
            text-anchor: middle;
            dominant-baseline: middle;
        }
    `;
    svg.appendChild(style);

    const spritesToExport = [...currentSprites];

    const cameraWorldPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraWorldPosition);
    
    spritesToExport.sort((a, b) => {
        const aPos = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
        const bPos = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
        return aPos.distanceTo(cameraWorldPosition) - bPos.distanceTo(cameraWorldPosition);
    }).reverse();

    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    spritesToExport.forEach(sprite => {
        const pos = new THREE.Vector3().setFromMatrixPosition(sprite.matrixWorld);
        
        if (!frustum.containsPoint(pos)) {
            return;
        }

        const projectedPos = pos.clone().project(camera);
        const x = (projectedPos.x * 0.5 + 0.5) * width;
        const y = (-projectedPos.y * 0.5 + 0.5) * height;

        const svgExportBaseSize = sprite.userData.baseSize * 2.5;

        let currentSpriteSize;
        if (sprite.userData.type === 'label') {
            if (sprite.userData.enableSize) {
                const baseScreenSize = svgExportBaseSize * 0.5;
                const scaledSize = baseScreenSize + (sprite.userData.normalizedComplexity * baseScreenSize * (sprite.userData.scalingFactor - 1));
                currentSpriteSize = Math.max(baseScreenSize, scaledSize);
            } else {
                currentSpriteSize = svgExportBaseSize * 0.5;
            }

            const text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', y);
            
            const fontSize = currentSpriteSize * 30; // Heuristic value
            text.setAttribute('font-size', `${fontSize}px`);

            const color = sprite.userData.textColor;
            if (color) {
                text.setAttribute('fill', `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`);
            } else {
                text.setAttribute('fill', 'white');
            }
            if (sprite.material.opacity < 1) text.setAttribute('fill-opacity', sprite.material.opacity);
            
            text.textContent = sprite.userData.ratio;
            svg.appendChild(text);

        } else if (sprite.userData.type === 'point') {
            if (sprite.userData.enableSize) {
                const baseScreenSize = svgExportBaseSize * 0.01;
                const scaledSize = baseScreenSize + (sprite.userData.normalizedComplexity * baseScreenSize * (sprite.userData.scalingFactor - 1));
                currentSpriteSize = Math.max(baseScreenSize, scaledSize);
            } else {
                currentSpriteSize = svgExportBaseSize * 0.01;
            }

            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            
            const radius = currentSpriteSize * 100; // Heuristic value
            circle.setAttribute('r', radius);
            
            const color = sprite.material.color;
            circle.setAttribute('fill', color.getStyle());
            circle.setAttribute('fill-opacity', sprite.material.opacity);
            svg.appendChild(circle);
        }
    });

    return new XMLSerializer().serializeToString(svg);
}

export function downloadSVG(svgString, filename) {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * The same drawing, rasterised.
 *
 * Not a grab of the WebGL framebuffer: that would be screen resolution, and
 * the labels in it would be the sprite textures rather than text. The PNG is
 * rendered from the SVG above instead — the same vector scene, drawn large —
 * which is how the reference app makes its own PNG, and it means the two
 * exports can never disagree about what was on screen.
 *
 * PRINT SIZE, NOT SCREEN SIZE. At 1x a point map is a smudge and at 2x it is
 * only a screenshot; 4x is a picture that survives a slide and a zoom. The
 * ceilings are the browser's rather than a taste: a canvas past a few tens of
 * megapixels comes back blank on some machines instead of failing, so a very
 * wide viewport is given whatever scale does fit.
 */
export function exportToPNG(filename = 'tetrads-export.png') {
    const view = document.getElementById('container');
    const width = (view && view.clientWidth) || window.innerWidth;
    const height = (view && view.clientHeight) || window.innerHeight;

    /* WITH A FIELD UP, THE PICTURE IS THE VIEW ITSELF.  The SVG below is the
       points as vectors, and a ray-marched volume is not a vector and never
       will be — so when the entropy field is showing, the PNG is the WebGL
       canvas, rendered once more and read straight back, at screen
       resolution. Read synchronously after the render, because the buffer
       is not kept after the frame is composited. */
    if (tetradModel === 'he' && currentVolume() && (tetradSlice || tetradVolume) && renderer) {
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
    }

    const MAX_SIDE = 12000, MAX_AREA = 60e6;
    const scale = Math.max(1, Math.min(4, MAX_SIDE / width, MAX_SIDE / height,
                                       Math.sqrt(MAX_AREA / (width * height))));

    const svgString = exportToSVG();
    const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        /* The SVG's own `background-color` rule is a CSS style on the root,
           which an <img> honours — but a PNG has no page behind it to fall
           back on, so the ground is painted in first and the drawing goes on
           top of it. Otherwise a black-ground layout exports transparent. */
        ctx.fillStyle = scene.background.getStyle();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
            if (!blob) return console.error('PNG export produced no image.');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        }, 'image/png');
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        console.error('PNG export could not rasterise the scene.');
    };
    image.src = url;
}

export function downloadCSV(csvString, filename) {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

export function simplifyFraction(n, d) {
    const commonDivisor = gcd(n, d);
    return `${n / commonDivisor}/${d / commonDivisor}`;
}

/**
 * The set, as numbers.
 *
 * Read from the set the generator recorded rather than off the sprites, so
 * it is the same with the marks turned off — and so that the entropy field,
 * when there is one, can say what it makes of each chord: the value at the
 * chord's own point, trilinear from the same cells the picture is drawn
 * from, in nats.
 */
export function exportToCSV() {
    const set = currentTetradSet();
    if (set.length === 0) {
        console.warn("No data to export.");
        return;
    }

    const complexityMethodSelect = document.getElementById('complexityMethod');
    const complexityMethod = complexityMethodSelect.options[complexityMethodSelect.selectedIndex].text;

    const vol = tetradModel === 'he' ? currentVolume() : null;
    const E = equaveCents(parseFloat(document.getElementById('equaveRatio').value) || 2);

    const data = [];
    const seen = new Set();
    for (const t of set) {
        if (seen.has(t.label)) continue;
        seen.add(t.label);
        const parts = t.label.split(':').map(Number);
        const fundamental = parts[0];
        const notes = parts.map(p => simplifyFraction(p, fundamental)).join(' ');
        const cents = parts.map(p => Math.round(1200 * Math.log2(p / fundamental))).join(' ');
        let value = '';
        if (vol) {
            const b = centsToBary(t.c1, t.c2, t.c3, E);
            const v = sampleVolume(vol, b.u, b.v, b.w);
            value = v === v ? v.toFixed(4) : '';
        }
        data.push({ chord: t.label, notes, cents, complexity: t.complexity, value });
    }

    // Sort by complexity, lowest first
    data.sort((a, b) => a.complexity - b.complexity);

    // Generate CSV content
    const header = `Chord,Notes,Cents,${complexityMethod}` + (vol ? ',HarmonicEntropy(nats)' : '');
    const rows = data.map(d => `${d.chord},"${d.notes}","${d.cents}",${d.complexity}` + (vol ? `,${d.value}` : ''));
    const csvContent = [header, ...rows].join('\n');

    downloadCSV(csvContent, 'tetrads-export.csv');
}
