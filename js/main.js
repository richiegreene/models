import {
    pyodide, python_ready, currentLayoutDisplay, latestUpdateToken,
    setPyodide, setPythonReady, setLatestUpdateToken,
    setScene, setCamera, setRenderer, setControls,
    setIsShiftHeld, setKeyState, setCurrentlyHovered,
    setPlayButton, setPivotButtons,
    enableNotation, setNotationDisplay,
    setCurrentLayoutDisplay
} from './globals.js';
import { initThreeJS, animate, onWindowResize, updatePivotButtonSelection } from './components/three-visualizer.js';
import { initAudio, stopChord, playChord, warmAudio } from './components/audio-engine.js';
import { updateTetrahedron, cycleLayoutMode } from './calculations/tetrahedron-updater.js';
import { setupUIEventListeners } from './utils/ui-handlers.js';
import { initMidiOutput } from './midi/midi-output.js';
import { TRIADS_PY } from './triads/triad-python.js';
import { DYADS_PY } from './dyads/dyad-python.js';
import { applyModeClasses } from './app-mode.js';
import { initTriads, bootTriads } from './triads/triad-mode.js';
import { initDyads } from './dyads/dyad-mode.js';

// --- MAIN PYODIDE INITIALIZATION ---
async function initPyodide() {
    
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';
    /* numpy is named here rather than loaded after, so its wheel comes down
       alongside the runtime instead of waiting for it. It is the only package:
       scipy was 48 MB of the ~67 MB this screen used to wait for, and the two
       things it was used for — an FFT convolution and a resample of the
       Sethares grid — are done in numpy in triads_generator now. */
    setPyodide(await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
        packages: ["numpy"],
    }));
    console.log("Pyodide and numpy loaded.");

    pyodide.setStdout({
        write: (msg) => {
            console.log("Python stdout:", msg);
        }
    });
    pyodide.setStderr({
        write: (msg) => {
            console.error("Python stderr:", msg);
        }
    });

    pyodide.FS.mkdir("python");
    pyodide.FS.mkdir("python/theory");

    const tetrahedron_generator_py_content = `import math
from itertools import combinations_with_replacement
from fractions import Fraction
from theory.calculations import get_odd_limit, get_integer_limit, check_prime_limit, parse_primes, _generate_valid_numbers, calculate_complexity, cents, gcd, get_virtual_fundamental_denominator

def generate_points(limit_value, equave_ratio, limit_mode=\"odd\", max_exponent=3, complexity_measure=\"Tenney\", hide_unison_voices=False, omit_octaves=False, virtual_fundamental_filter=None):
    points = []
    equave_ratio_float = float(equave_ratio)
    
    valid_numbers = _generate_valid_numbers(limit_value, limit_mode, max_exponent, equave_ratio_float)

    if not valid_numbers: return []

    sorted_valid_numbers = sorted(list(valid_numbers))
    
    primes = []
    if limit_mode == \"prime\":
        primes = parse_primes(limit_value)

    for combo in combinations_with_replacement(sorted_valid_numbers, 4):
        if hide_unison_voices and len(set(combo)) < 4: continue
        
        if omit_octaves:
            has_octave = False
            for i in range(len(combo)):
                for j in range(i + 1, len(combo)):
                    if combo[i] == 0: continue
                    ratio = combo[j] / combo[i]
                    if ratio > 1 and math.isclose(math.log2(ratio), round(math.log2(ratio))):
                        has_octave = True
                        break
                if has_octave:
                    break
            if has_octave:
                continue

        i, j, k, l = combo
        
        if i == 0: continue
        if l / i > equave_ratio_float: continue
        if gcd(gcd(gcd(i, j), k), l) != 1: continue

        if virtual_fundamental_filter:
            vf_denom = get_virtual_fundamental_denominator(combo)
            if vf_denom is None or vf_denom not in virtual_fundamental_filter:
                continue
            
        valid_combo = True
        intervals = [Fraction(j, i), Fraction(k, j), Fraction(l, k)]
        if limit_mode == \"odd\":
            limit_val_int = int(limit_value)
            for interval in intervals:
                if get_odd_limit(interval) > limit_val_int:
                    valid_combo = False
                    break
        elif limit_mode == \"integer\":
            limit_val_int = int(limit_value)
            for interval in intervals:
                if get_integer_limit(interval) > limit_val_int:
                    valid_combo = False
                    break
        elif limit_mode == \"prime\":
            for interval in intervals:
                if not check_prime_limit(interval, primes, int(max_exponent)):
                    valid_combo = False
                    break
        
        if not valid_combo: continue
        
        c1 = cents(j / i)
        c2 = cents(k / j)
        c3 = cents(l / k)
        
        complexity = max(calculate_complexity(complexity_measure, f) for f in intervals)
        
        points.append((c1, c2, c3, complexity))
        
    return points
`;
    pyodide.FS.writeFile("python/tetrahedron_generator.py", tetrahedron_generator_py_content, { encoding: "utf8" });

    const calculations_py_content = `import math
from fractions import Fraction
from functools import reduce
from math import gcd
from itertools import combinations_with_replacement

def cents(x):
    return 1200 * math.log2(float(x)) if x > 0 else 0

def lcm(a, b):
    return abs(a * b) // gcd(a, b) if a != 0 and b != 0 else 0

def lcm_list(numbers):
    return reduce(lcm, numbers) if numbers else 0

def get_virtual_fundamental_denominator(chord):
    if not chord or chord[0] == 0:
        return None
    ratios = [Fraction(note, chord[0]).limit_denominator() for note in chord]
    denominators = [r.denominator for r in ratios]
    return lcm_list(denominators)

def get_odd_part_of_number(num):
    if num == 0: return 0
    while num > 0 and num % 2 == 0: num //= 2
    return num

def get_odd_limit(ratio):
    try:
        ratio = Fraction(ratio).limit_denominator(10000)
        n, d = ratio.numerator, ratio.denominator
        return max(get_odd_part_of_number(n), get_odd_part_of_number(d))
    except (ValueError, ZeroDivisionError): return 1

def get_integer_limit(ratio):
    try:
        ratio = Fraction(ratio).limit_denominator(10000)
        return max(ratio.numerator, ratio.denominator)
    except (ValueError, ZeroDivisionError): return 1

def get_prime_factors(n):
    factors = {}
    d = 2
    n = int(n)
    while d * d <= n:
        while (n % d) == 0:
            factors[d] = factors.get(d, 0) + 1
            n //= d
        d += 1
    if n > 1:
        factors[n] = factors.get(n, 0) + 1
    return factors

def check_prime_limit(ratio, primes, max_exponent):
    ratio = Fraction(ratio).limit_denominator(10000)
    num_factors = get_prime_factors(ratio.numerator)
    den_factors = get_prime_factors(ratio.denominator)
    for p, exp in num_factors.items():
        if p not in primes or exp > max_exponent: return False
    for p, exp in den_factors.items():
        if p not in primes or exp > max_exponent: return False
    return True

def parse_primes(limit_value_str):
    limit_value_str = str(limit_value_str)
    if '.' in limit_value_str:
        return [int(p) for p in limit_value_str.split('.') if p.isdigit()]
    else:
        limit = int(limit_value_str)
        primes = []
        for num in range(2, limit + 1):
            is_prime = all(num % i != 0 for i in range(2, int(num**0.5) + 1))
            if is_prime: primes.append(num)
        return primes

def tenney_norm(ratio):
    ratio = Fraction(ratio).limit_denominator(10000)
    return math.log2(ratio.numerator * ratio.denominator)

def weil_norm(ratio):
    ratio = Fraction(ratio).limit_denominator(10000)
    return math.log2(max(ratio.numerator, ratio.denominator))

def wilson_norm(ratio):
    # Wilson height: every prime counted as many times as it actually occurs.
    #
    # get_prime_factors returns {prime: exponent}, and summing a dict in Python
    # sums its KEYS — so this used to discard the exponents entirely and score
    # 81/64 at 5, exactly as simple as 3/2. Multiplicity is the whole content
    # of the measure.
    ratio = Fraction(ratio).limit_denominator(10000)
    factors_n = get_prime_factors(ratio.numerator)
    factors_d = get_prime_factors(ratio.denominator)
    return (sum(p * e for p, e in factors_n.items())
            + sum(p * e for p, e in factors_d.items()))

def gradus_norm(ratio):
    # Euler's gradus suavitatis: sum of e*(p-1) over the factorisation, plus 1.
    # Same correction as wilson_norm above — it counted each distinct prime
    # once however many times it appeared.
    ratio = Fraction(ratio).limit_denominator(10000)
    factors_n = get_prime_factors(ratio.numerator)
    factors_d = get_prime_factors(ratio.denominator)
    return (sum(e * (p - 1) for p, e in factors_n.items())
            + sum(e * (p - 1) for p, e in factors_d.items()) + 1)

def benedetti_norm(ratio):
    # Benedetti height is the PRODUCT of the two terms — which is what makes it
    # the quantity Tenney takes the log of. It used to return their sum, which
    # made it an exact duplicate of arithmetic_norm below: two entries in the
    # Complexity menu computing one measure.
    ratio = Fraction(ratio).limit_denominator(10000)
    return ratio.numerator * ratio.denominator

def arithmetic_norm(ratio):
    ratio = Fraction(ratio).limit_denominator(10000)
    return ratio.numerator + ratio.denominator

def calculate_complexity(complexity_measure, ratio):
    norms = {
        "Tenney": tenney_norm, "Weil": weil_norm, "Wilson": wilson_norm,
        "Gradus": gradus_norm, "Benedetti": benedetti_norm, "Arithmetic": arithmetic_norm
    }
    return norms.get(complexity_measure, lambda r: 0)(ratio)

def _generate_valid_numbers(limit_value, limit_mode, max_exponent=3, equave_ratio=2.0):
    valid_numbers = set()
    if limit_mode == "odd":
        limit_val = int(limit_value)
        max_num_to_check = max(limit_val * int(equave_ratio) * 2, 200)
        for num in range(1, max_num_to_check + 1):
            if get_odd_part_of_number(num) <= limit_val:
                valid_numbers.add(num)
    elif limit_mode == "integer":
        limit_val = int(limit_value)
        for num in range(1, limit_val + 1):
            valid_numbers.add(num)
    elif limit_mode == "prime":
        primes = parse_primes(limit_value)
        if not primes: return {1}
        bound = int(equave_ratio) * max(primes) * int(max_exponent) * 2
        valid_numbers = {1}
        q = [1]
        visited = {1}
        while q:
            curr = q.pop(0)
            for p in primes:
                next_num = curr * p
                if next_num > bound: continue
                factors = get_prime_factors(next_num)
                is_valid = True
                for factor, exp in factors.items():
                    if factor not in primes or exp > int(max_exponent):
                        is_valid = False
                        break
                if is_valid and next_num not in visited:
                    valid_numbers.add(next_num)
                    visited.add(next_num)
                    q.append(next_num)
    return valid_numbers if valid_numbers else {1}

def estimate_combinations(limit_value, equave_ratio, limit_mode="odd", max_exponent=3, voices=4):
    """How many chords the generator would have to walk, before it walks them.

    The generators are combinations_with_replacement over the valid numbers, so
    the count is C(n + k - 1, k) and it is knowable without generating
    anything — which matters because the growth is brutal: doubling the limit
    roughly doubles n, and the count goes as n^4 for tetrads. A limit of 13 is
    a hundred thousand chords and a mistyped 1113 is ten trillion, and the
    second one is indistinguishable from a hang.

    Cheap enough to ask before every single generation, which is what makes it
    possible for the panel to apply itself without a press to gate it.
    """
    try:
        nums = _generate_valid_numbers(limit_value, limit_mode, max_exponent, float(equave_ratio))
    except Exception:
        return -1
    n = len(nums)
    if n <= 0:
        return 0
    k = int(voices)
    total = 1
    for i in range(k):
        total = total * (n + i) // (i + 1)
    return total

def generate_ji_tetra_labels(limit_value, equave_ratio, limit_mode='odd', max_exponent=3, complexity_measure='Tenney', hide_unison_voices=False, omit_octaves=False, virtual_fundamental_filter=None):
    labels_data = []
    equave_ratio_float = float(equave_ratio)
    valid_numbers = _generate_valid_numbers(limit_value, limit_mode, max_exponent, equave_ratio_float)
    if not valid_numbers: return []
    sorted_valid_numbers = sorted(list(valid_numbers))
    primes = parse_primes(limit_value) if limit_mode == "prime" else []

    for combo in combinations_with_replacement(sorted_valid_numbers, 4):
        if hide_unison_voices and len(set(combo)) < 4: continue
        if omit_octaves:
            has_octave = False
            for i in range(len(combo)):
                for j in range(i + 1, len(combo)):
                    if combo[i] == 0: continue
                    ratio = combo[j] / combo[i]
                    if ratio > 1 and math.isclose(math.log2(ratio), round(math.log2(ratio))):
                        has_octave = True; break
                if has_octave: break
            if has_octave: continue

        i, j, k, l = combo
        if i == 0: continue
        if (l / i) > equave_ratio_float: continue
        if gcd(gcd(gcd(i, j), k), l) != 1: continue

        if virtual_fundamental_filter:
            vf_denom = get_virtual_fundamental_denominator(combo)
            if vf_denom is None or vf_denom not in virtual_fundamental_filter:
                continue

        valid_combo = True
        intervals = [Fraction(j, i), Fraction(k, j), Fraction(l, k)]
        if limit_mode == "odd":
            limit_val_int = int(limit_value)
            if any(get_odd_limit(interval) > limit_val_int for interval in intervals): valid_combo = False
        elif limit_mode == "integer":
            limit_val_int = int(limit_value)
            if any(get_integer_limit(interval) > limit_val_int for interval in intervals): valid_combo = False
        elif limit_mode == "prime":
            if any(not check_prime_limit(interval, primes, int(max_exponent)) for interval in intervals): valid_combo = False
        
        if not valid_combo: continue
            
        c1 = cents(j / i)
        c2 = cents(k / j)
        c3 = cents(l / k)
        
        complexity = max(calculate_complexity(complexity_measure, f) for f in intervals)
        label = f"{i}:{j}:{k}:{l}"
        labels_data.append(((c1, c2, c3), label, complexity))
        
    return labels_data
`;
    pyodide.FS.writeFile("python/theory/calculations.py", calculations_py_content, { encoding: "utf8" });
    pyodide.FS.writeFile("python/theory/__init__.py", "", { encoding: "utf8" });

    /* The other two modes' generators, written beside the tetrahedron's and
       importing the same theory/calculations.py rather than carrying their own
       copies of the limit tests — so a 13-limit means one thing in this app
       whether it is being read over three intervals, two, or one. Dyads goes
       in after Triads because it imports the Plomp-Levelt kernel from it
       rather than restating it. */
    pyodide.FS.writeFile("python/triads_generator.py", TRIADS_PY, { encoding: "utf8" });
    pyodide.FS.writeFile("python/dyads_generator.py", DYADS_PY, { encoding: "utf8" });

    pyodide.runPython("import sys; sys.path.append('./python')");

    setPythonReady(true);
    loadingOverlay.style.display = 'none';

    initThreeJS();
    animate();

    /* All three stages exist from the start; only one of them is asked to
       draw. See animate(), which stands down whenever the tetrahedron is not
       the mode, and switchMode in app-mode.js, which builds each of the other
       two the first time it is actually wanted. */
    setCurrentLayoutDisplay(document.getElementById('layoutDisplay').value);
    setPlayButton(document.getElementById('playButton'));
    setPivotButtons(document.querySelectorAll('.pivot-button'));
    setNotationDisplay(document.getElementById('notation-display'));

    // The timbre and the envelope are set from the panel's own store — see
    // setupUIEventListeners, which builds the picker and the ADSR editor.
    updatePivotButtonSelection(0); // Set initial pivot to Bass (index 0)

    // Setup all UI event listeners
    setupUIEventListeners();

    /* The audio graph, built now and left suspended, so the first tap on the
       triangle has something to play rather than something to wait for — see
       warm. It makes no sound until a gesture resumes it. */
    warmAudio();

    /* The app opens in Triads, so the triangle is what gets generated. The
       other two cost a blocked thread nobody has asked for yet, so they wait
       until they are asked: each registers itself here and generates on its
       first visit. Attaching a pane is free — measuring a canvas and binding
       a pointer — so that part happens for all of them now. */
    initDyads();
    initTriads();
    /* After the two of them have registered, not before: applyModeClasses asks
       the registry what the mode is called, and a mode that has not said yet
       would have its own name written into the drawer headings in lower case. */
    applyModeClasses('triads');
    await bootTriads();
}


// Initial call to start the application
initPyodide();
