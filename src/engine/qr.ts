/**
 * A very small QR encoder, for exactly one job: putting the phone page's
 * address on the kitchen screen so somebody can point a camera at it.
 *
 * Why write one instead of pulling in a library — the kiosk's whole front end
 * is 350KB and this is the only thing on the page that would need a
 * dependency. The scope is deliberately narrow: byte mode, error correction
 * level L, versions 1 to 5. That tops out at 108 bytes, and the longest thing
 * it will ever be asked to encode is "http://192.168.1.255:8787/mobile" —
 * thirty-two.
 *
 * Level L rather than something sturdier because this is displayed on a lit
 * screen a foot from the camera, not printed on a box. Versions 1-5 because
 * they are all single-block, which means no interleaving, which removes the
 * part of the QR spec most likely to be subtly wrong.
 *
 * Checked module-for-module against a reference implementation across every
 * version and mask — see qrverify.py.
 */

/** [total codewords, error-correction codewords] per version, level L, 1 block. */
const CAPACITY_L: Record<number, { total: number; ec: number }> = {
  1: { total: 26, ec: 7 },
  2: { total: 44, ec: 10 },
  3: { total: 70, ec: 15 },
  4: { total: 100, ec: 20 },
  5: { total: 134, ec: 26 },
};

/** Centre coordinate of the single alignment pattern. Version 1 has none. */
const ALIGNMENT_CENTRE: Record<number, number | null> = { 1: null, 2: 18, 3: 22, 4: 26, 5: 30 };

/* ---------------------------------------------------------------- *
 * GF(256), the field QR's Reed-Solomon lives in
 * ---------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: number[], ecCount: number): number[] {
  const gen = generator(ecCount);
  const remainder = new Array(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i += 1) {
        remainder[i] ^= mul(gen[i + 1], factor);
      }
    }
  }
  return remainder;
}

/* ---------------------------------------------------------------- *
 * Bit stream
 * ---------------------------------------------------------------- */

function encodeData(text: string, version: number): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const { total, ec } = CAPACITY_L[version];
  const dataCount = total - ec;

  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // versions 1-9 use an 8-bit length in byte mode
  for (const b of bytes) push(b, 8);

  // Terminator, up to four zero bits, then pad to a byte boundary.
  const capacityBits = dataCount * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }

  // The spec's two pad bytes, alternating, until the block is full.
  const PADS = [0xec, 0x11];
  while (codewords.length < dataCount) codewords.push(PADS[(codewords.length - bits.length / 8) % 2]);

  return [...codewords, ...errorCorrection(codewords, ec)];
}

/* ---------------------------------------------------------------- *
 * Module placement
 * ---------------------------------------------------------------- */

type Grid = { size: number; modules: (boolean | null)[][]; reserved: boolean[][] };

function blank(version: number): Grid {
  const size = 17 + version * 4;
  return {
    size,
    modules: Array.from({ length: size }, () => new Array(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
}

function setModule(g: Grid, r: number, c: number, dark: boolean, reserve = true) {
  g.modules[r][c] = dark;
  if (reserve) g.reserved[r][c] = true;
}

function placeFinder(g: Grid, row: number, col: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= g.size || cc < 0 || cc >= g.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setModule(g, rr, cc, inRing || inCore);
    }
  }
}

function placeAlignment(g: Grid, centre: number) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      setModule(g, centre + r, centre + c, dark);
    }
  }
}

function placeFunctionPatterns(g: Grid, version: number) {
  placeFinder(g, 0, 0);
  placeFinder(g, 0, g.size - 7);
  placeFinder(g, g.size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < g.size - 8; i += 1) {
    const dark = i % 2 === 0;
    setModule(g, 6, i, dark);
    setModule(g, i, 6, dark);
  }

  const centre = ALIGNMENT_CENTRE[version];
  if (centre != null) placeAlignment(g, centre);

  // The one module that is always dark, for reasons lost to history.
  setModule(g, g.size - 8, 8, true);

  // Reserve the format-information strips; the values go in after masking.
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      g.reserved[8][i] = true;
      g.reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    g.reserved[8][g.size - 1 - i] = true;
    g.reserved[g.size - 1 - i][8] = true;
  }
}

function placeData(g: Grid, codewords: number[]) {
  const bits: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((cw >> i) & 1);
  }

  let bit = 0;
  let upward = true;

  for (let right = g.size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // skip the vertical timing column

    for (let step = 0; step < g.size; step += 1) {
      const row = upward ? g.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (g.reserved[row][col]) continue;
        g.modules[row][col] = bit < bits.length ? bits[bit] === 1 : false;
        bit += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(g: Grid, mask: number): boolean[][] {
  const out = g.modules.map((row) => row.map((v) => !!v));
  for (let r = 0; r < g.size; r += 1) {
    for (let c = 0; c < g.size; c += 1) {
      if (g.reserved[r][c]) continue;
      if (MASKS[mask](r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

/** BCH(15,5) format information, level L (01) plus the mask, XORed per spec. */
function formatBits(mask: number): number[] {
  const data = (0b01 << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (value & (1 << (i + 10))) value ^= 0b10100110111 << i;
  }
  const combined = ((data << 10) | value) ^ 0b101010000010010;
  const bits: number[] = [];
  for (let i = 14; i >= 0; i -= 1) bits.push((combined >> i) & 1);
  return bits;
}

function placeFormat(modules: boolean[][], size: number, mask: number) {
  const bits = formatBits(mask);

  // Copy 1: around the top-left finder.
  for (let i = 0; i <= 5; i += 1) modules[8][i] = bits[i] === 1;
  modules[8][7] = bits[6] === 1;
  modules[8][8] = bits[7] === 1;
  modules[7][8] = bits[8] === 1;
  for (let i = 9; i <= 14; i += 1) modules[14 - i][8] = bits[i] === 1;

  // Copy 2: seven modules climbing the left edge, then eight along the top
  // right. Seven, not eight — module (size-8, 8) is the always-dark one, and
  // writing a format bit over it is a one-pixel error that still scans on a
  // good day and fails on a bad one.
  for (let i = 0; i <= 6; i += 1) modules[size - 1 - i][8] = bits[i] === 1;
  for (let i = 7; i <= 14; i += 1) modules[8][size - 15 + i] = bits[i] === 1;
}

/* ---------------------------------------------------------------- *
 * Mask selection
 * ---------------------------------------------------------------- */

function penalty(m: boolean[][], size: number): number {
  let score = 0;

  // Rule 1: runs of five or more identical modules.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const cur = horizontal ? m[i][j] : m[j][i];
        const prev = horizontal ? m[i][j - 1] : m[j - 1][i];
        if (cur === prev) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules beside it.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      let matchA = true;
      let matchB = true;
      let matchAv = true;
      let matchBv = true;
      for (let k = 0; k < 11; k += 1) {
        if (m[i][j + k] !== A[k]) matchA = false;
        if (m[i][j + k] !== B[k]) matchB = false;
        if (m[j + k][i] !== A[k]) matchAv = false;
        if (m[j + k][i] !== B[k]) matchBv = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
      if (matchAv) score += 40;
      if (matchBv) score += 40;
    }
  }

  // Rule 4: deviation from an even split of dark and light.
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (m[r][c]) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ---------------------------------------------------------------- *
 * Public
 * ---------------------------------------------------------------- */

/**
 * Encode `text` as a QR matrix. Returns rows of booleans, dark = true.
 * Throws if the text is longer than version 5 at level L can hold (108 bytes).
 */
export function encodeQR(text: string, forceMask?: number): boolean[][] {
  const length = new TextEncoder().encode(text).length;

  let version = 0;
  for (let v = 1; v <= 5; v += 1) {
    const { total, ec } = CAPACITY_L[v];
    if (length + 2 <= total - ec) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error(`"${text.slice(0, 24)}…" is too long for this encoder`);

  const grid = blank(version);
  placeFunctionPatterns(grid, version);
  placeData(grid, encodeData(text, version));

  const render = (mask: number) => {
    const candidate = applyMask(grid, mask);
    placeFormat(candidate, grid.size, mask);
    return candidate;
  };

  if (forceMask != null) return render(forceMask); // for the verifier

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = render(mask);
    const score = penalty(candidate, grid.size);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best!;
}

/** Exposed so the verifier can compare penalties mask by mask. */
export function maskPenalties(text: string): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((m) => {
    const grid = encodeQR(text, m);
    return penalty(grid, grid.length);
  });
}

/**
 * The matrix as an SVG string, with the quiet zone the spec asks for.
 * Drawn as one path rather than a few hundred rects — same picture, a fifth
 * of the DOM.
 */
export function qrToSvg(text: string, { size = 160, quiet = 4 } = {}): string {
  const matrix = encodeQR(text);
  const n = matrix.length;
  const dim = n + quiet * 2;

  let path = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (matrix[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    `</svg>`
  );
}
