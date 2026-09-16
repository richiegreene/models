
/* No three.js here on purpose. This module is pure arithmetic over colours —
   nothing in it touches a scene — and keeping it that way means the colour
   model can be tested on its own, without a browser or a GPU. */

/* The halftone is the one layout that is not a colour at all, and it reads
   this module's theme; the two import each other, and neither touches the
   other's bindings until it is called. */
import { halftoneOn, halftoneSignature, inkHex, groundHex } from './halftone.js';

/* =====================================================================
 *  THE COLOUR LAYOUTS
 * =====================================================================
 *
 * Everything that colours anything reads this one table: the panel's chips are
 * painted by sampling it, the tetrahedron's sprites are baked from it, and the
 * triangle's shading, contours, dots and surface all come out of it.
 *
 * WHAT IS ON OFFER, AND WHY ONLY THESE.  Five ramps, and they are matplotlib's
 * five perceptually uniform sequential maps — viridis, plasma, inferno, magma,
 * cividis. "Perceptually uniform" is the whole selection rule: equal steps in
 * complexity have to look like equal steps in colour, or the picture says
 * something the numbers do not. The ramps this replaced were hand-picked
 * gradients through arbitrary stops, and a hand-picked gradient banded — it
 * invented edges where the field was smooth and flattened real ridges where
 * two of its stops happened to sit close together. Cividis earns its place
 * separately: it is the one of the five that survives red-green colour
 * blindness with its ordering intact.
 *
 * THE GROUND IS NO LONGER PART OF A LAYOUT.  It used to be: there were two
 * columns of chips, a dark set drawn on black and a bright set drawn on paper,
 * and picking a ramp also picked a background. That made twelve chips for what
 * is really two decisions, and it meant the only way to read Magma on white
 * was to give up Magma. The ground is now the app's theme — one toggle at the
 * foot of the rail — and every layout is drawn on whichever ground is up.
 *
 * On a light ground the ramps are sampled backwards. This is not a second
 * palette, it is the same ramp read the other way: a ramp's bright end is its
 * signal end, and on black the simplest chords should glow while on paper they
 * should go to ink. Leaving the direction alone would put the simplest chords
 * — the ones the picture exists to show — at pale yellow on white paper, which
 * is to say nowhere.
 *
 * GRADIENT LAYOUTS vs THE CONSTANT.  The five ramps turn value into hue, and
 * the 3D surface is coloured per-vertex so its height and its colour say the
 * same thing twice. That is legible, and it is also flat — every facet is lit
 * identically, so the shape reads as a contour map that happens to be tilted.
 *
 * CONSTANT does the opposite. The surface is one colour — the colour YOU pick,
 * from the swatch on its chip — and all of the modelling comes from light: an
 * angled key, a soft fill, and a specular highlight that slides across the
 * peaks as the shape turns. Height stops being redundant with colour and
 * starts being the only thing carrying the model, which is what makes a
 * shallow ridge you would miss in a ramp visible as a ridge. The flat pane
 * renders it as hillshading — the same light on the same surface, seen from
 * directly above — so the two panes stay two views of one thing. Its chip is
 * drawn as a rectangle of flat colour rather than as a gradient strip,
 * because that is what the layout is.
 * ------------------------------------------------------------------ */

/** A ramp through a list of hex stops, evenly spaced. */
function rampFromStops(hexes) {
    const stops = hexes.map((h) => ({
        r: ((h >> 16) & 255) / 255,
        g: ((h >> 8) & 255) / 255,
        b: (h & 255) / 255,
    }));
    return (value) => {
        const t = Math.min(1, Math.max(0, value)) * (stops.length - 1);
        const i = Math.min(stops.length - 2, Math.floor(t));
        const f = t - i;
        const a = stops[i], b = stops[i + 1];
        return { r: a.r + f * (b.r - a.r), g: a.g + f * (b.g - a.g), b: a.b + f * (b.b - a.b) };
    };
}

/* matplotlib's own control points, ten evenly spaced samples of each map.
   Ten is enough that linear interpolation between them stays inside the
   uniformity the maps were built for — these curves are smooth by
   construction, so the error between samples is well under a just-noticeable
   difference. Written as stops rather than as a 256-entry table because a
   table that long is unreadable and, in the one that used to be here, was
   quietly wrong: it had been filled in by hand and drifted off viridis
   entirely above the midpoint. */
export const viridisColormap = rampFromStops([
    0x440154, 0x482878, 0x3e4989, 0x31688e, 0x26828e,
    0x1f9e89, 0x35b779, 0x6ece58, 0xb5de2b, 0xfde725,
]);
export const plasmaColormap = rampFromStops([
    0x0d0887, 0x46039f, 0x7201a8, 0x9c179e, 0xbd3786,
    0xd8576b, 0xed7953, 0xfb9f3a, 0xfdca26, 0xf0f921,
]);
export const infernoColormap = rampFromStops([
    0x000004, 0x1b0c41, 0x4a0c6b, 0x781c6d, 0xa52c60,
    0xcf4446, 0xed6925, 0xfb9b06, 0xf7d13d, 0xfcffa4,
]);
export const magmaColormap = rampFromStops([
    0x000004, 0x180f3d, 0x440f76, 0x721f81, 0x9e2f7f,
    0xcd4071, 0xf1605d, 0xfd9668, 0xfeca8d, 0xfcfdbf,
]);
export const cividisColormap = rampFromStops([
    0x00224e, 0x123570, 0x3b496c, 0x575d6d, 0x707173,
    0x8a8678, 0xa59c74, 0xc3b369, 0xe1cc55, 0xfee838,
]);

const rgb = (hex) => ({
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
});
const hexOf = ({ r, g, b }) => (
    (Math.round(Math.min(1, Math.max(0, r)) * 255) << 16)
    | (Math.round(Math.min(1, Math.max(0, g)) * 255) << 8)
    | Math.round(Math.min(1, Math.max(0, b)) * 255)
);

/** Rec. 709 relative luminance, 0..1. */
export function luminance(hex) {
    const c = rgb(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Whether a ground counts as light — which decides the ink everything else is
 * drawn in, and whether the panel goes to day mode.
 *
 * Still a luminance test rather than an equality one, even though there are
 * now only two grounds. It is what every renderer already asks, and asking it
 * of the colour means a ground can later be tinted — cream rather than hard
 * white — without a single caller changing.
 */
export function isLightGround(hex) {
    return luminance(hex) > 0.55;
}

/** A ground as CSS, for the canvas and the exporter. */
export function groundCss(hex) {
    return '#' + (hex >>> 0).toString(16).padStart(6, '0');
}

/* ---------------------------------------------------------------------
 *  The theme
 *
 *  One switch, at the foot of the rail, and it decides the ground for every
 *  layout as well as the chrome the panel is drawn in. It is state rather than
 *  a constant because it is the user's; ui-handlers.js is what remembers it
 *  across sessions, so this module stays free of the browser.
 * ------------------------------------------------------------------ */

export const DARK_GROUND = 0x000000;

/* The lightness every light ground is mixed at, and it is Keyboard
   Designer's viewport grey: its 3D view clears to [214,214,214], and a
   colourless source run through `groundFor` below comes back at exactly that.
   So the neutral case is that app's own grey to the byte, and every tinted
   ground is the same value of it wearing a hue. The two apps get looked at in
   one sitting and share their whole chrome, so a shape lifted out of one and
   set beside a shape from the other should be sitting at the same brightness. */
const LIGHT_GROUND_L = 214 / 255;

/* How much hue a ground is allowed. A ground is furniture: it has to be
   plainly warm or plainly cool without becoming a colour in its own right and
   competing with the field drawn on it. Well under the source's own
   saturation, which for these ramps is near-total. */
const LIGHT_GROUND_S = 0.28;

let theme = 'dark';

/** 'dark' | 'light'. */
export function currentTheme() { return theme; }

export function setTheme(next) {
    theme = next === 'light' ? 'light' : 'dark';
    return theme;
}

/** Whether the ground is the light one — the question renderers actually ask. */
export function themeIsLight() { return theme === 'light'; }

/* ---- hue arithmetic, for the tinted grounds ---- */

function hslOf(hex) {
    const { r, g, b } = rgb(hex);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, s, l };
}

function hexFromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const i = Math.floor(h / 60) % 6;
    const [r, g, b] = [
        [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][i];
    return hexOf({ r: r + m, g: g + m, b: b + m });
}

/**
 * Where along a ramp the ground takes its hue from.
 *
 * NOT THE END. The end is where the ground was read from first, and it did
 * not work: these five maps are all built to finish at maximum brightness, and
 * at maximum brightness there is almost no hue left to have. Their final
 * colours land between 53° and 63° — five yellows — so five grounds came back
 * within two units of each other and the background was, in practice, static.
 *
 * THE MIDPOINT, then — the part of a ramp that actually identifies it. Halfway
 * along, these five are as far apart as they ever get: viridis is teal at
 * 172°, cividis a warm grey at 45°, and the three fire maps fan out across the
 * reds — inferno 359°, plasma 351°, magma 337°. Every other sample point pulls
 * them together, because they converge at both ends by construction: all five
 * start near-black and all five finish near-yellow, and only the middle is
 * theirs alone.
 *
 * What it costs is that the ground no longer echoes the colour at the end of
 * the ramp. It echoes the colour the ramp is KNOWN by instead, which is the
 * more useful of the two things a ground can say — and it is the only one of
 * them that can be said at all, since the ends do not differ.
 */
const GROUND_SAMPLE = 0.5;

function groundSourceOf(ramp) {
    return hexOf(ramp(GROUND_SAMPLE));
}

/**
 * The ground a layout is drawn on.
 *
 * ON BLACK, ALWAYS BLACK. Nothing to derive: a dark ground's whole job is to
 * be absent, and tinting it would put a colour under a picture whose own
 * colours are the data.
 *
 * ON PAPER, THE LAYOUT'S OWN HUE. The ground takes its hue from the ramp's
 * midpoint — see GROUND_SAMPLE for why there and not from either end — held at
 * one fixed lightness and a low saturation. So the page a map is drawn on
 * belongs to that map: viridis gets a cool green ground, magma and plasma
 * rosy ones, cividis a warm neutral, and changing the colormap changes the
 * room as well as the ink.
 *
 * The constant has no ramp to look at, so it uses the body colour itself —
 * the same rule, since that colour is the whole of what the layout is. Its
 * ground is the only one here that can be any hue at all, and a grey chosen
 * in the swatch gives back Keyboard Designer's grey exactly.
 */
function groundFor(sourceHex) {
    if (theme !== 'light') return DARK_GROUND;
    const { h, s } = hslOf(sourceHex);
    return hexFromHsl(h, Math.min(s, LIGHT_GROUND_S), LIGHT_GROUND_L);
}

/* ---------------------------------------------------------------------
 *  The constant
 *
 *  Its colour is the user's, so it is state rather than a literal, and the
 *  entry below is resolved against it every time it is read. One remembered
 *  colour rather than one per ground: the swatch is a choice about the
 *  material, and having it silently change out from under the toggle would
 *  make the toggle look like it recoloured the surface.
 * ------------------------------------------------------------------ */
export const constantColors = { body: 0x8894a6 };

export function setConstantColor(hex) {
    constantColors.body = hex & 0xffffff;
}

/**
 * The highlight a body of this colour should throw.
 *
 * Not a fixed colour, because the same specular cannot serve both ends: a
 * black body has no diffuse to speak of and its shape exists ONLY where the
 * light catches it, so it needs a highlight far brighter than itself; a body
 * already near white needs one well under it, or the highlight clips whole
 * slopes flat and takes the relief with it. So the target brightness runs
 * opposite to the body's, and the hue is pulled most of the way to neutral —
 * a highlight is the colour of the lamp, not of the thing.
 */
function specularFor(hex) {
    const c = rgb(hex);
    const l = luminance(hex);
    /* The floor is not decoration. A pale body's highlight is dimmer than its
       own diffuse, so it can only show as the crests clipping to white — and
       below about 0.4 it does not reach even that, which made Gloss do
       nothing at all on a near-white constant. */
    const target = Math.min(0.88, Math.max(0.40, 1.12 - l * 1.25));
    const here = Math.max(0.02, l);
    const k = target / here;
    return hexOf({
        r: c.r * k * 0.35 + target * 0.65,
        g: c.g * k * 0.35 + target * 0.65,
        b: c.b * k * 0.35 + target * 0.68,
    });
}

/**
 * The constant's ramp — what its points, dots, labels, contours and curve are
 * coloured by.
 *
 * ONE COLOUR, AT EVERY VALUE. A layout called Constant that spread its colour
 * across a range would be a gradient wearing another name, and the complexity
 * it was drawing would be said twice — once by the size and once by a ramp the
 * layout is supposed not to have. It is flat in all three modes: a tetrahedron
 * of one colour, a lattice of one colour, a curve of one colour.
 *
 * What that costs is that COLOUR carries nothing here, which is the point of
 * the layout rather than a defect of it. A constant is for reading a shape off
 * its lighting and its geometry, so the measure is left to Size; if colour
 * should carry it, one of the five ramps is the layout that does that.
 *
 * WHY IT IS NOT LITERALLY THE SWATCH COLOUR.  The swatch sets the BODY — the
 * lit surface, drawn in exactly that colour and read off its highlight. Marks
 * drawn ON that surface have the opposite job: they have to be seen against it
 * and against the ground. So the mark colour is the body's own hue taken to a
 * brightness it can be read at, which is ink on the light ground and light on
 * the dark one.
 *
 * Scaled rather than mixed toward white or black, so the hue and the
 * saturation survive: pick a red and the marks are a brighter red, not pink.
 */
function constantRamp(hex, lightGround) {
    const c = rgb(hex);
    /* Ink on paper, light on black. Far enough from either ground to read
       without being so far that a dark layout starts to glare. */
    const target = lightGround ? 0.18 : 0.62;
    const k = target / Math.max(0.02, luminance(hex));
    const flat = {
        r: Math.min(1, c.r * k),
        g: Math.min(1, c.g * k),
        b: Math.min(1, c.b * k),
    };
    /* A fresh object per call, matching what rampFromStops returns — several
       callers keep what they are handed. */
    return () => ({ r: flat.r, g: flat.g, b: flat.b });
}

/**
 * @typedef {object} Colormap
 * @property {string} name        what the chip says
 * @property {string} title       what the chip's tooltip says
 * @property {(t:number)=>{r,g,b}} ramp
 * @property {number} ground      the background — the theme's, for every layout
 * @property {boolean} constant   true if its colour is the user's
 * @property {?object} material   present iff the 3D surface is lit rather than
 *                                value-coloured: `{ color, specular, shininess }`
 */

/* The order is the order the chips are laid out in. The five ramps run in
   matplotlib's own order — viridis first, as the default of the family — and
   Constant comes last because it is the one that is not a ramp. */
const RAMPS = [
    {
        name: 'Viridis', ramp: viridisColormap,
        title: 'Perceptually uniform: deep violet through green to yellow. The safe default — it survives greyscale printing and most colour blindness.',
    },
    {
        name: 'Plasma', ramp: plasmaColormap,
        title: 'Perceptually uniform: dark blue through magenta to yellow. The most saturated of the five, so fine structure separates hardest.',
    },
    {
        name: 'Inferno', ramp: infernoColormap,
        title: 'Perceptually uniform: near-black through crimson and orange to pale yellow. The widest brightness range of the five.',
    },
    {
        name: 'Magma', ramp: magmaColormap,
        title: 'Perceptually uniform: near-black through plum and rose to cream. Inferno’s cooler twin — gentler at the bright end.',
    },
    {
        name: 'Cividis', ramp: cividisColormap,
        title: 'Perceptually uniform and colour-vision-deficiency safe: navy through slate to gold, with its ordering intact for red-green colour blindness.',
    },
];

/**
 * The layouts, in chip order, resolved against the current theme and the
 * current constant colour.
 *
 * A ramp is sampled backwards on the light ground. Its bright end is its
 * signal end and the simplest chords sit there, so on black they glow and on
 * paper they have to go to ink instead — the alternative is drawing the thing
 * the picture is about in pale yellow on a pale page.
 */
export function colormaps() {
    const light = themeIsLight();
    const list = RAMPS.map((m) => ({
        name: m.name,
        title: m.title,
        ramp: light ? (t) => m.ramp(1 - Math.min(1, Math.max(0, t))) : m.ramp,
        /* Each ramp brings its own ground rather than all of them sharing
           one, so switching colormaps in day mode repaints the page as well
           as the picture. Derived from the ramp itself — see groundFor. */
        ground: groundFor(groundSourceOf(m.ramp)),
        constant: false,
        material: null,
    }));

    const hex = constantColors.body;
    list.push({
        name: 'Constant',
        title: 'One colour of your choosing, modelled entirely by light rather than by a ramp — the shape is read off its highlight and its shading. Pick the colour with the swatch.',
        ramp: constantRamp(hex, light),
        ground: groundFor(hex),
        constant: true,
        material: {
            color: hex,
            specular: specularFor(hex),
            shininess: 62,
            /* A dark body needs the fill kept down or the key cannot carve
               anything; a pale one needs it up or the shadows go to mud. */
            ambient: 0.14 + luminance(hex) * 0.34,
        },
    });
    return list;
}

/** How many there are. Used by the cycling shortcut and the mode arithmetic. */
export const COLORMAP_COUNT = RAMPS.length + 1;

/**
 * The layout currently counted by `currentLayoutMode`.
 *
 * WITH THE HALFTONE ON, THIS IS WHERE IT TAKES OVER.  The renderers ask this
 * for their ground and their ramp, so the override lives here rather than in
 * each of them: the ground becomes the theme's pure black or white, and the
 * ramp becomes the ink at every value — a safety net for anything that still
 * colours by value, so that nothing in a screened picture can come out in a
 * colour. The chips are painted from colormaps() itself and keep showing the
 * layouts as they are; see paintChips.
 */
export function colormapAt(index) {
    const all = colormaps();
    const map = all[((index % all.length) + all.length) % all.length];
    if (!halftoneOn()) return map;
    const ink = rgb(inkHex());
    return {
        ...map,
        ground: groundHex(),
        ramp: () => ink,
        constant: false,
        material: null,
        halftone: true,
    };
}

/**
 * Everything about a layout that a rendered picture depends on.
 *
 * The renderers cache what they have drawn, and they used to key that cache on
 * the layout's INDEX — which is wrong for the constant, whose colour can
 * change without the index moving, and wrong now for every layout, since the
 * theme moves the ground under all of them. Anything holding a painted surface
 * should hold this beside it instead.
 */
export function layoutSignature(index) {
    const m = colormapAt(index);
    return `${index}|${m.ground}|${m.material ? m.material.color : 'ramp'}|${halftoneSignature()}`;
}

/**
 * How a layout is lit, at this Gloss setting.
 *
 * Gloss is one control over two quite different situations, and it does not
 * mean the same thing to both — which is the whole reason the arithmetic is
 * here rather than duplicated in the two renderers.
 *
 *   A GRADIENT layout is not lit at all. Its colours ARE the values, and
 *   shading them by the local slope would make the map lie about its own
 *   numbers. So gloss adds only a highlight over the top — a varnish on the
 *   map rather than a light on it.
 *
 *   THE CONSTANT is one colour modelled by light, so gloss runs its full
 *   range: at 0 the surface is MATTE — shaded by the key and the fill, with no
 *   highlight at all — and at 1 it is a mirror. The shading alone still
 *   carries the relief, so matte is a reading of the shape rather than the
 *   absence of one; how legible it is depends on the colour you picked, which
 *   is yours to pick.
 *
 * @param {Colormap} map
 * @param {number} gloss 0..1
 */
export function lighting(map, gloss) {
    const g = Math.min(1, Math.max(0, gloss));
    const tint = (hex, k) => {
        const c = rgb(hex);
        return hexOf({ r: c.r * k, g: c.g * k, b: c.b * k });
    };

    if (map.material) {
        const m = map.material;
        return {
            material: true,
            color: m.color,
            ambient: m.ambient ?? 0.3,
            /* Straight through, with no floor under it: at 0 the specular is
               black, which is a matte surface — the diffuse shading is left to
               carry the relief on its own. */
            specular: tint(m.specular, g),
            /* A dull sheen is a broad one and a wet one is tight, so shininess
               rises too — otherwise turning gloss up would only make the same
               soft patch brighter until it clipped. */
            shininess: m.shininess + g * (118 - m.shininess),
            /* Still lit even at 0: `strength` says whether to shade at all,
               and a matte constant is shaded, just not shiny. */
            strength: 1,
        };
    }

    return {
        material: false,
        color: 0xffffff,
        ambient: 1,
        specular: tint(0xffffff, g * 0.55),
        shininess: 10 + g * 84,
        strength: g,
    };
}
