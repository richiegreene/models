# Models
## https://models.richiegreene.com/

Interactive tetrahedron of JI tetrads — a playable triangle of JI triads, and a playable line of JI dyads — with the ability to scale via harmonic complexity models.  
Sounds, shapes, colors ... Go nuts! Approaching this as a sort of 3D take off of Sintel's [triangle](https://sintel.website/posts/triangle.html). All three carry [harmonic entropy](https://en.xen.wiki/w/Harmonic_entropy) as a model — a curve over the dyads, a surface over the triads, and, for the tetrads, a *volume* (4HE) computed with the multivariate Gaussian that pitch space implies, which you can cut through like a tomograph and play. One statement of the model serves the three; see [Harmonic entropy](#harmonic-entropy) at the end.

## Demo
![display demo](https://github.com/user-attachments/assets/4247d114-28db-4907-9da5-dc5b3bece989)

The panel is a side rail of four modes — Complexity Measures, Display, Play and Export — borrowed, along with the synth and the JI notation engines, from [Keyboard Designer](https://github.com/richiegreene/keyboards). Pressing the mode you are already in shuts the drawer and gives the width back to the view.

**Nothing needs applying.** There is no Update and no Generate: every control in every drawer applies itself a beat after you stop moving it. The wait is deliberate — the models run in Python, on the page's own thread, so recomputing on every intermediate value of a drag would freeze the slider being dragged. What used to be the Update button is now the line at the foot of the panel saying what came of it: how many chords are in the set, which model is under the triangle, and what it cost.

One thing is still asked for explicitly. The number of chords grows as the fourth power of the limit — odd-limit 13 is a hundred and twenty thousand tetrads, and a slipped keystroke making that 1113 is a *trillion* — so before generating anything the app works out how big the job would be, and anything past a couple of million is reported rather than run: *"1.0 billion tetrads — press ↵ to generate anyway"*. `↵` also just means *don't wait* for any ordinary change.

## Dyads / Triads / Tetrads
Pinned above the drawers is a switch between three apps that ask the same questions of different chords. One voice at a time, and one dimension.

**Tetrads** is the tetrahedron above: four voices, three intervals, one point per chord.

**Triads** is three voices and two intervals, which fit in a triangle — so the chords can be laid over a continuous *concordance surface* and played by dragging across it.

**Dyads** is two voices and one interval, which fits on a line — so the measure itself can be the picture, plotted against the interval in cents and played by dragging along it.

All three are built from the same Limit, Equave and Complexity Measure, so a 13-limit means one thing in this app, and all three are written out by the same notation engines.

The triangle's bottom-left corner is the unison; its bottom-right puts the whole equave in the lower interval, and its apex puts it in the upper one.

## Dyads
Nine ways of measuring how complex the interval between two notes is, on one axis, playable by dragging along it.

A dyad has a single degree of freedom, which changes what a picture of it can be. The triangle needs a contour map and a lifted surface side by side because a shaded surface says *where* a concordance is or *how deep* it is but not both; a curve says both in the same mark. So there is one pane, no view switch, and the vertical axis is free to be the thing the mode is actually about.

### Measures
The **Measure** fieldset chooses what the plot is a picture of. The first option is a different kind of answer from the other three.

* **Ratios** — whichever of the six measures the **Complexity** fieldset is set to: Tenney, Weil, Wilson, Euler, Benedetti, Arithmetic. These are functions of a ratio's two numbers, so they have a value at every just interval and *none between them*. There is no curve; the measure is the height of the lattice itself.
* **Entropy** — [harmonic entropy](https://en.xen.wiki/w/Harmonic_entropy) along the axis, in nats. Every ratio under the height bound is stamped at its own cents with weight $1/\|j\|$, blurred by the ear's uncertainty, and the Rényi entropy of the blur taken — the same five settings as the other two modes (**Spread** $s$, **Order** $a$, **Series**, **Height** $N$, **Kernel**), stated once under [Harmonic entropy](#harmonic-entropy). The readout under the cursor and the CSV give the entropy itself; the plot turns it over so that concordant is high, like the other measures. Probabilistic, and knows nothing about timbre.
* **Sethares** — [sensory dissonance](https://sethares.engr.wisc.edu/consemi.html), every partial of the lower tone against every partial of the upper, from *whatever timbre the Play drawer is currently set to*. Physical, and knows nothing about arithmetic. Only the cross terms are counted: a tone's partials also beat against each other, but that is the same at every interval and including it would flatten the curve without moving a peak.
* **Tenney** — the Tenney norm *made continuous*. $\log_2(pq)$ is defined only at the ratios, so a parabola is let down from each one and the curve is the lowest surface any of them reaches:

  $$T(x) = \min_{p/q}\;\Big(\tfrac{x - \text{cents}(p/q)}{s}\Big)^{2} + \log_2(pq)$$

  A simple ratio digs a deep well and a complex one a shallow dimple. **Softness** is $s$ — the one number deciding whether the curve is a row of spikes or a smooth landscape.

**Span** is the plot's own axis control: how many equaves wide it is. The Equave belongs to all three modes and is not this one's to change, but a dyad is the one chord that stays perfectly readable past it.

### Display
* **Curve** — **Fill** shades the area under the curve through the colormap *by value*, so the colour says what the height says. **Line** strokes it, through the same colormap and along its own length: the value is a function of the horizontal position and of nothing else, so a stroke coloured by the value is a stroke with a horizontal gradient on it. **Line size** is how thick, from half a pixel to eight — which is the point of colouring it, because at eight pixels the line is wide enough to read as a band of colour rather than as a contour. The whole fieldset goes when the measure has no curve to draw.
* **Plot › Grid lines** — the cents ruler, the gridlines, the tick labels, the axis title and the frame. Turned off they all go, *and the margins they were being kept for go with them*, so the measure is drawn across the whole pane. The cursor loses its crosshair and its readout to match: a dot on a line, and nothing else on screen. It is not a degraded view — the shape of a concordance curve is legible without a single number on it, and once you know what the axes are the furniture is only in the way.
* **Plot › Relief** — how much of the pane's height the measure is allowed to use. Scaled about the **middle** rather than the floor, so turning it down settles the curve toward a straight line across the centre of the page instead of crushing it into the bottom edge. Everything vertical goes through it together — the curve, the lattice stems and the floor they stand on, the axis marks — so a low relief is a smaller picture of the same plot rather than a curve floating loose under furniture drawn at full size. Colour is taken from the *value* rather than the height, so a settled curve stays coloured by the numbers it actually has.
* **Lattice** — Dots stems every just interval up to the curve, a stem rather than a bare dot because the mark has to say two things: where the interval is, and what the measure makes of it. Labels are placed simplest-first and any that would collide with one already placed is dropped, so 3/2 is never buried under 27/16.
* **Snap** — how close the pointer must come to a just interval before it lands on it exactly. At 0 the axis is continuous everywhere.

### Playing the line
Press and drag anywhere in the box — the height is the measure's answer, not an input, so the whole pane is playable rather than only the hairline of the curve. The two voices are struck **once**, on the way down, and every move after that leads those same running voices to the new pitch. **Tracking › Portamento** is how tightly they follow.

The **Pivot** — **S** or **T** — is not a refinement here, it is what the gesture *means*. Hold the lower voice and dragging right takes the upper one up; hold the upper and the same drag takes the lower one down. Same interval, opposite motion, and they do not sound the same. The `s` and `t` keys select it. Space puts the next dyad back on 1/1 = C3.

### Export, in Dyads
* **.svg** — **no raster at any resolution.** The triangle's exporter has to embed its shading as an image because a continuously shaded scalar field is one polygon per grid cell; a curve has no such problem. The fill and the stroke share one 256-stop linear gradient sampled from the colormap itself, and everything else is a path, a circle or real text. Grid lines, Line size and Relief all apply, so a bare render exports bare.
* **.png** — rasterised from that SVG at up to 4x.
* **.csv** — the dyads with their cents, their complexity under the measure the whole app is set to, and the current model's value at each one.

## Triads
Three voices, two intervals, and a concordance surface you can drag a chord across.

### Models
What the ground between the just triads is measuring. Pick one and it builds itself; move any of its numbers and it rebuilds a moment after your hand comes off.
* **Blank** — no field: the JI lattice on a plain ground
* **Entropy** — [harmonic entropy](https://en.xen.wiki/w/Harmonic_entropy) over the triangle, after Sintel's [3HE notebook](https://gist.github.com/Sin-tel/8d1a55a0e34ca159ac6aa61e325648d2). Every triad under the height bound is stamped at its point with weight $1/\sqrt{abc}$, blurred by an isotropic Gaussian — which is what "every voice mistuned independently" comes to on the equilateral triangle, with $\sigma = s\sqrt{3}/2$ — and the Rényi entropy of the blur taken. Peaks are concordances (the surface is lifted by concordance; the numbers underneath are entropy in nats, which is what the CSV carries). The five settings are the same as the other two modes', under [Harmonic entropy](#harmonic-entropy). Spread is asked in cents rather than pixels, so raising Resolution sharpens the picture instead of changing the model.
* **Sethares** — [sensory dissonance](https://sethares.engr.wisc.edu/consemi.html), computed from the partials of *whatever timbre the Play drawer is currently set to*. Change the wave and the surface changes with it, which is the whole claim of the model: how rough a chord sounds is a fact about its spectrum, not only about its ratios.

### Display
* **View**: Topology, 3D, or **Both** — side by side and linked to one cursor. The contour map says exactly *where* a concordance is and nothing about how deep; the lifted surface says how deep and blurs where. Drag either and the other follows.
* **Fill** and **Lines** are independent: a field can be shaded, contoured, both, or neither with only the lattice left.
* **Relief** — how far the 3D pane lifts the field.
* **Lattice**: Dots and Labels, and **Snap** — how close the pointer must come to a just triad before it lands on it exactly. At 0 the surface is continuous everywhere.

### Playing the triangle
In the **flat** pane, press and drag — there is nothing else to do there. In the **lifted** pane a plain drag *turns* the surface and **⇧-drag** plays it, exactly as ⇧ sounds the tetrahedron, so the modifier means one thing across the whole app. The surface is also turned by the arrow keys, kept turning by Rotate Continuously and paced by `[` and `]` — the same Motion setting, and the same rate, as the tetrahedron. It frames itself to the pane whenever it is shown, resized, or given a new model.

Either way, the three voices are struck **once**, when the pointer goes down, and every move after that leads those same running voices to the new pitch — so a drag is one chord bending through the field rather than a stream of re-attacks. **Tracking › Portamento** is how tightly they follow: at 0 the pitch sits exactly under the pointer, and a little smoothing takes the stair-stepping off a fast drag.

The **Pivot** — **S**, **A** or **T** — is the voice held still while the other two move, the same press Tetrads makes with S/A/T/B over four voices (a triad has no bass under its tenor). The `s`, `a` and `t` keys select it, as they do there. Switching it while a chord is sounding is silent: the incoming pivot inherits the pitch that voice already has. Space puts the next chord back on 1/1 = C3.

### Export, in Triads
* **.svg** — the shading is an embedded image (a continuously shaded scalar field is not vector art), but everything drawn on it stays vector: contours are paths, the lattice is circles, the labels are text. Turn Fill off and Lines on and the file is vectors end to end.
* **.png** — the flat pane rasterised from that SVG at up to 4x; the lifted pane straight from the view.
* **.csv** — the triads, with a column for the current model's value at each one.

## Tetrads
Four voices, three intervals, one point per chord — and, since the field, a volume between the points.

### Model
What fills the tetrahedron. **Blank** is the points on their own. **Entropy** is [harmonic entropy](https://en.xen.wiki/w/Harmonic_entropy) over the whole shape — at every point, in just intonation or not — computed as a $128^3$ volume in a second or two, with the same five settings as the line and the triangle ([Harmonic entropy](#harmonic-entropy)) and its own **Resolution** in cells per axis. The readout beside Resolution says what a cell is in cents, and the foot marks ⚠ when the cell is too coarse for the order asked for (a Rényi order $a$ is taken with the kernel narrowed by $\sqrt{a}$; hover the foot for the sentence).

The blur is *not* isotropic in the three intervals: pitch space says the intervals of a chord whose voices are independently mistuned are correlated, and the volume is blurred with exactly that Gaussian — see [Chords](#chords). The set of tetrads the entropy is taken against is every tetrad under the height bound, not only those the limit admits; the limit decides which are *marked*.

### Field
A volume cannot be looked at the way a surface can — every point is behind some other point — so there are two pictures of it, and they are independent switches like the triangle's Fill and Lines:

* **Cut** — a plane through the field, opaque, coloured by the entropy exactly where it cuts: a tomograph's section. It is always parallel to a face, which keeps it a triangle and makes it mean something. **Cut along** chooses which interval it holds constant, and **Position** is that interval in cents:
  * **Span** — every tetrad with the same outer interval, bass to soprano; the two inner voices roam the triangle. From the apex (a unison) to the base (the whole equave — where the section is the triads' own triangle with an octave added).
  * **Lower** — the lower interval held: a triangle of triads over a fixed bass step.
  * **Middle** — the middle interval held.
  * **Upper** — the upper interval held: a triangle of triads under a fixed top step.
* **Body** — the whole field as a translucent solid, drawn by marching a ray through it from the eye: concordance is opaque and discordance is clear, so the simplest chords hang in it as wells and turning the shape turns the constellation. **Density** is how opaque; **Focus** is how sharply the wells stand out of the haze (an exponent on concordance — at 1 the whole shape is a mist, at 4 only the most concordant few percent show).

Both together is the picture the mode is for: a bright section moving through a ghost. The body stops at the cut on the eye's side, so the section reads as the face of a solid you have opened. **Sweep the cut** moves it back and forth through the whole shape on its own, a pass every eight seconds, with the slider following.

The field is drawn in WebGL2 (a filtered 3D texture on the card); the colormap and the theme apply to it as to everything else, and **Type/Setting › None** takes the points away to leave the field alone.

### Playing the cut
**⇧-drag** on the cut sounds the tetrad under the pointer and leads it across the section — Tetrads' own modifier, and the triangle's own gesture: the four voices are struck once, on the way down, and every move after that glides those same running voices, so a drag is one chord bending through the field. **Tracking › Portamento** is how tightly they follow. The pivot is the tetrahedron's S/A/T/B, and the two ways of playing share it: a drag picks up from the last hovered point, and a hover afterwards leads from wherever the drag ended. **Snap** lands the pointer on the nearest just tetrad of the set within so many cents. A bead marks the sounding chord; with Display Notation on, the readout spells the simplest just tetrad within a few cents of it.

### Export, in Tetrads
With the field up, **.png** is the view itself — a ray-marched volume is not a vector and never will be — at screen resolution; **.svg** stays the points as vectors. **.csv** carries a `HarmonicEntropy(nats)` column when the field is up: the value at each tetrad's own point, read from the same cells the picture is drawn from.

## Display 
### Controls
* Rotate Tetrahedron: click/drag or arrow keys
* Keep it turning: Rotate Continuously, under Display › Visuals › Motion. While it runs the arrow keys steer it rather than nudging it.
* Rotation rate: [ and ], or the Motion slider beside it — one rate for both, so 34°/s is a turn every eleven seconds whether you hold an arrow or watch it spin.
  * Continuous Rotation: caps lock + arrow keys
    * speed up: ] or }
    * slow dow: [ or {
* Zoom: two-finger scroll/mouse-wheel
* Layout/Looks: ⇧⌘L cycles the colormap; the same twelve are in Display › Visuals as swatches. Ten are ramps, where colour carries the measure. The two **Constant** layouts are one colour and no gradient — in all three modes — because their surface is meant to be read off its lighting and its geometry, with the measure left to Size; the swatch on the chip sets the body colour, and the marks drawn on it take that colour's hue at a brightness the ground can be read against.
  * Plasma, Viridis and Magma — perceptually uniform ramps
  * Blue — [Isoharmonics](https://github.com/richiegreene/isoharmonics)' own gradient, stop for stop
  * Black and White — greyscale, named for the ground the set is drawn on: on black the simplest chords come out brightest, on white they go to ink
  * Petroleum and Porcelain — **material** layouts rather than ramps. The 3D surface is one colour and every bit of the modelling comes from light: an angled key, a soft fill, and a specular highlight that travels across the peaks as the shape turns. Height stops being redundant with colour and becomes the only thing carrying the model, so a shallow ridge a ramp would flatten into one band shows up as a ridge. Petroleum is the extreme case — a black slick with almost no body, read entirely off the sheen. The flat pane renders these as hillshading — the same light on the same surface, seen from straight above — so the two panes stay two views of one thing.
* **Gloss** (Triads only, under the swatches) is how wet the lifted surface is. On the two material layouts it runs from matte to a mirror. On the ordinary ramps it lays a highlight *over* the colours without shading them — the colours are the values there, and dimming them by the local slope would make the map lie about its own numbers — so at 0 they are exactly the flat surfaces they were before the control existed. It only appears in Triads: the tetrahedron is drawn as flat sprites, and there is no surface for a light to catch.
* **Day mode** comes on by itself whenever the view is drawn on white (White, Porcelain): the rail and the drawer go light with the viewport, on Keyboard Designer's own tokens. A dark panel against a white view is a bezel with a lamp behind it.
* (Beta Feature) Hand Tracking: ⇧⌘K 

### Settings
* Select/Define Limit of JI terads.
  * [Integer-Limit](https://en.xen.wiki/w/Odd_limit#Integer_limit)
  * [Odd-limit](https://en.xen.wiki/w/Odd_limit)
  * [Prime-Limit](https://en.xen.wiki/w/Harmonic_limit#Prime_limits_as_subgroups) - accepts subgroups, e.g. "2.3.7" 
* Select the register considered
  * default "2" for 2/1 octave
* Set the Complexity Model which scale/color JI ratios $\dfrac{n}{d}$. 
  * Arithmetic, $n+d$
  * [Benedetti](https://en.xen.wiki/w/Benedetti_height), $nd$
  * [Euler](https://en.xen.wiki/w/Gradus_suavitatis), $s-n+1$ where $s$ is the sum of prime factors and $n$ is number of prime factors.
  * [Tenney](https://en.xen.wiki/w/Tenney_norm), $\log_2(n \cdot d)$
  * [Weil](https://en.xen.wiki/w/Weil_norm,_Tenney%E2%80%93Weil_norm,_and_TWp_interval_and_tuning_space), $log_2(max(n,d))$
  * [Wilson](https://en.xen.wiki/w/Wilson_norm), sum of prime factors (with repetition) $\text{sopfr}(pq)$
* Display: Points (Dots) or Labels (Enumerated Ratios)
* Notation: depicts played chord as ratio or cents
  * Refference pitch: 1/1 = C3 130.8128Hz
* Base Size: Set minimum size (e.g. 0.25) of Point/Label
* Scaling Factor: adjust to change rate of sizing/coloration difference
* Omit Unisons/Octaves to display only chords with unique pitch classes

### Notation
How the sounding chord is written out. Reference pitch: 1/1 = C3 130.8128Hz.
* All — ratio, HEJI and 12EDO deviation at once
* Ratio — the enumerated ratio itself
* [HEJI](https://marsbat.space/pdfs/HEJI2_legend+series.pdf) — Helmholtz-Ellis Just Intonation
* [Sagittal](https://sagittal.org/) — with Athenian / Promethean / Herculean / Olympian precision, and revo (pure) or evo (beside a conventional sharp or flat)
* Cents — cents above 1/1
* 12EDO — the nearest 12EDO note and the cents off it

## Playback
### Controls
* ⇧: hover to play corresponding chord
* ⇧+Hover(Click Hold): sustain a chord; next chord on release
* s, a, t, b keys to toggle the pivot/common-tone between adjacent chords
* Change Pressure (for MPE):
  * reduce via L or RH keycommands: ! or _-
  * increase via L or RH keycommands: @ or +=

### Settings
* Playback: In-browser audio, MIDI Polyphonic Expression (MPE), or both
* Portamento: how long (0–5 s) the four voices take to reach the next tetrad. At 0 they arrive at once.
* Set pivot voice (common-tone) with S A T B buttons (or keys)
* Timbre: two families over the same four shapes — sine, triangle, saw, square
  * Wavetable — a fixed, band-limited waveform, volume-independent
  * Filtered wavetable — a sine phase-modulated by its own low-passed output, so quiet notes stay near-sine and loud ones fold into a buzz
* Envelope: drag the corners of the ADSR curve. In the filtered family the fold is driven by amplitude, so the envelope is part of the timbre rather than a level applied after it.

## Export
Everything is in the Export drawer, and the key commands still work.

### Picture
What the camera is looking at, at the size of the viewport, with anything outside the frustum left out — so turn the shape to the angle you want first.
* Save View (.svg): ⇧⌘E — vectors, every point a circle and every label real text
* Save View (.png) — the same view rasterised from that SVG at up to 4x

### Data
* Save Chords (.csv): ⇧⌘S
  * Enumerated Chords ($a:b:c:d$), Notes ($\dfrac{n}{d}$), Cents, and Complexity — sorted simplest first.

## Harmonic entropy
One statement of the model serves the three modes: it is written to Pyodide as `he_core.py` (source in [js/he/he-python.js](js/he/he-python.js)), and each mode's generator does only what is particular to its dimension — which chords are in the basis set, and where they land on the grid. Sources: the Xenharmonic Wiki's [Harmonic entropy](https://en.xen.wiki/w/Harmonic_entropy) (Erlich; the convolution form and the Rényi generalisation by Battaglia), Mike Battaglia's [HE-JS](http://www.mikebattagliamusic.com/HE-JS/HE.html) calculator, and Sintel's [harmonic_entropy_triads.ipynb](https://gist.github.com/Sin-tel/8d1a55a0e34ca159ac6aa61e325648d2).

### The model
An incoming chord $c$ (an interval in cents; a point in two or three intervals for triads and tetrads) is matched against a basis set $J$ of just chords. Each $j \in J$ is given an unnormalised probability from a **spreading function** $S$ centred on $j$ and a **weight** $\|j\|$:

$$Q(j\,|\,c) = \frac{S(\mathrm{¢}(j) - c)}{\|j\|}, \qquad P(j\,|\,c) = \frac{Q(j\,|\,c)}{\sum_{k \in J} Q(k\,|\,c)}$$

and the harmonic entropy of $c$ is the entropy of that distribution. **Order** $a$ selects the [Rényi entropy](https://en.xen.wiki/w/Harmonic_entropy#Harmonic_R%C3%A9nyi_entropy):

$$\mathrm{HE}_a(c) = \frac{1}{1-a}\,\log \sum_{j \in J} P(j\,|\,c)^a$$

with $a \to 1$ Shannon's $-\sum P \log P$ (Erlich's original), $a = 2$ collision entropy, and $a \to \infty$ min-entropy $-\log \max P$. The app opens at $a = 4$ in all three modes; 1 is the wiki's worked example and 7 is Sintel's. Nats throughout.

### The basis set and its weights
**Series** and **Height** $N$ decide which chords are in $J$ and, with them, the weighting — because the weight is the width of the domain each chord owns between its neighbours, which Erlich observed to scale with the height the set is bounded by:

| Series | Basis set | $\|j\|$ |
|---|---|---|
| Tenney | $n d \le N$ (chords: $a b c \cdots \le N$) | $\sqrt{nd}$ (chords: $\sqrt{abc\cdots}$) |
| Weil | $\max(n,d) \le N$ (chords: $\max \le N$) | $\max(n,d)$ (chords: $\max$) |

The Height slider sets the **root** of the bound, so that one number is one depth of series in every mode: root 100 is $nd \le 10\,000$ for a dyad (the wiki's and HE-JS's default) and $abc \le 10^6$ for a triad; root 300 is Sintel's $abc \le 27\,000\,000$; root 60 is $abcd \le 60^4$. Only reduced chords are stamped ($\gcd = 1$), and every ordering of a chord within reach of an edge of the picture is stamped too — the dyad $d/n$ below the unison, the triad $a{:}c{:}b$ across the bottom edge from $a{:}b{:}c$ — so an edge is a real neighbourhood and not a cliff in the basis set.

### The spreading function
**Spread** $s$ is the standard deviation of $S$ in cents; 17 ¢ is the canonical one percent of frequency, and the panel says both. **Kernel** is its shape: Gaussian $\exp(-x^2/2s^2)$, or the heavier-tailed Laplace ("Vos") curve $\exp(-\sqrt2\,|x|/s)$, scaled to the same $s$ — the two members of the generalised normal family the wiki mentions.

### Computed by convolution
Stamp every basis chord onto a grid as a delta of weight $1/\|j\|$ (the kernel $K$) and of weight $1/\|j\|^a$ ($K^a$). Then, as the wiki's convolution-based expression has it,

$$\psi(c) = [S * K](c), \qquad \rho_a(c) = [S^a * K^a](c), \qquad \mathrm{HE}_a(c) = \frac{1}{1-a}\,\log\frac{\rho_a(c)}{\psi(c)^a}$$

which is $O(N \log N)$ by FFT; the scale of $S$ cancels in the quotient, so the kernel is never normalised. For $a = 1$ the same trick gives Shannon exactly rather than as a limit:

$$\sum_j Q\log Q = [S * K_{w\log w}] + [(S\log S) * K], \qquad \mathrm{HE}_1 = \log\psi - \frac{\sum_j Q\log Q}{\psi}$$

The line is 1600 samples over the axis and the triangle 420 across, both with a cell far finer than $s$, and a chord that falls between cells is split between them (HE-JS's interpolation). The volume's cell is a fraction of $s$, and there a chord is stamped to its nearest cell instead (Sintel's method): splitting a stamp lowers the entropy at the minima by the gap between the power mean and the plain mean of the kernel across a cell, which is a thousandth of a nat at one cent and a third of a nat at two thirds of $s$. Against a straight port of HE-JS the line agrees to four decimal places at every order.

### Chords
A chord of $n$ voices is a point in $n-1$ successive intervals $d = (c_1, c_2, \ldots)$, and the spreading function has to say how the ear's uncertainty spreads over those. The one assumption that generalises the dyad without a new parameter: each voice is independently mistuned by $\mathcal N(0, s^2/2)$, so that every pairwise interval — a difference of two voices — has standard deviation exactly $s$. The intervals then have covariance

$$\Sigma = \frac{s^2}{2}\,D, \qquad D = \mathrm{tridiag}(-1,\,2,\,-1), \qquad S(d) = \exp\!\left(-\tfrac12\, d^{\mathsf T}\Sigma^{-1} d\right)$$

For three voices $\Sigma^{-1} = \frac{2}{3s^2}\begin{pmatrix}2&1\\1&2\end{pmatrix}$, which is **isotropic** in Sintel's equilateral coordinates $x = c_1 + c_2/2,\; y = c_2\sqrt3/2$ with $\sigma = s\sqrt3/2$ — his std of 15 is $s \approx 17.3$ ¢, the canonical one percent. That is why the triangle is the honest picture of a triad: it is pitch space's own metric. For four voices $\Sigma^{-1} = \frac{1}{2s^2}\begin{pmatrix}3&2&1\\2&4&2\\1&2&3\end{pmatrix}$, and no linear picture is both a regular tetrahedron and isotropic (the interval simplex under that metric is a disphenoid), so the volume keeps the regular tetrahedron the app has always drawn and states the kernel in interval coordinates as the anisotropic Gaussian above: each interval's marginal spread is $s$, adjacent intervals anticorrelated by $-\tfrac12$ exactly as they are when the voice they share moves.

The volume is a cube of $R^3$ cells over $[0,E]^3$ in $(c_1, c_2, c_3)$; the tetrahedron is its simplex under the barycentric map $u = c_1/E,\; v = c_2/E,\; w = c_3/E,\; a_0 = 1-u-v-w$ (the apex is $1{:}1{:}1{:}1$, the base corners the tetrads with the whole equave in one interval), and a cut holding one barycentric coordinate constant is a triangle parallel to a face — which is what the Field drawer's four axes are.
