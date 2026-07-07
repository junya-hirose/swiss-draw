// QR Code generator, based on the algorithm from Project Nayuki's QR Code generator library (MIT).
// Reimplemented in TypeScript.
//
// Scope:
// - Byte mode only (input text is encoded as UTF-8)
// - Error correction level M
// - Versions 1 to 10, selected automatically (throws if the input does not fit)
// - All 8 mask patterns are tried and the one with the lowest penalty score is used
//
// The public entry point is qrModules(). A few internal primitives are also
// exported purely so that they can be unit-tested; they are all pure functions.

/*---- Public API ----*/

/**
 * Encodes the given text as a QR Code symbol (byte mode, ECC level M,
 * version 1-10 auto-selected) and returns the module matrix.
 *
 * The result is a square 2-D array indexed as result[row][col], where
 * true means a dark (black) module. The quiet zone is NOT included;
 * callers should add a 4-module light border when rendering.
 *
 * @throws Error if the UTF-8 encoding of the text does not fit in a
 *         version 10 level M QR Code (213 bytes).
 */
export function qrModules(text: string): boolean[][] {
	const data: number[] = encodeUtf8(text);

	// Auto-select the smallest version that fits the data.
	let version = -1;
	for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
		const capacityBits: number = getNumDataCodewords(v) * 8;
		const neededBits: number = 4 + charCountBits(v) + data.length * 8;
		if (neededBits <= capacityBits) {
			version = v;
			break;
		}
	}
	if (version === -1)
		throw new Error(
			`Data too long: ${data.length} bytes exceeds the capacity of a ` +
			`version ${MAX_VERSION} level M QR Code`);

	// Build the data bit stream: mode indicator, character count, payload.
	const bits: number[] = [];
	appendBits(0x4, 4, bits); // Byte mode indicator
	appendBits(data.length, charCountBits(version), bits);
	for (const b of data)
		appendBits(b, 8, bits);

	// Terminator, bit padding, byte padding (0xEC / 0x11 alternating).
	const dataCapacityBits: number = getNumDataCodewords(version) * 8;
	appendBits(0, Math.min(4, dataCapacityBits - bits.length), bits);
	appendBits(0, (8 - bits.length % 8) % 8, bits);
	for (let padByte = 0xEC; bits.length < dataCapacityBits; padByte ^= 0xEC ^ 0x11)
		appendBits(padByte, 8, bits);

	// Pack bits into data codewords (big-endian within each byte).
	const dataCodewords: number[] = [];
	for (let i = 0; i < bits.length; i += 8) {
		let b = 0;
		for (let j = 0; j < 8; j++)
			b = (b << 1) | bits[i + j];
		dataCodewords.push(b);
	}

	const allCodewords: number[] = addEccAndInterleave(dataCodewords, version);
	return buildMatrix(allCodewords, version);
}

/*---- Constants ----*/

const MIN_VERSION = 1;
const MAX_VERSION = 10;

// Format-info bit pattern for error correction level M (L=1, M=0, Q=3, H=2).
const ECC_FORMAT_BITS = 0;

// Number of ECC codewords per block for level M, indexed by version (index 0 unused).
// From Project Nayuki's ECC_CODEWORDS_PER_BLOCK table, row M, versions 1-10.
const ECC_CODEWORDS_PER_BLOCK: readonly number[] =
	[0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];

// Number of error correction blocks for level M, indexed by version (index 0 unused).
// From Project Nayuki's NUM_ERROR_CORRECTION_BLOCKS table, row M, versions 1-10.
const NUM_ERROR_CORRECTION_BLOCKS: readonly number[] =
	[0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

// Total number of codewords (data + ECC), indexed by version (index 0 unused).
const TOTAL_CODEWORDS: readonly number[] =
	[0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

// Alignment pattern center coordinates, indexed by version (index 0 unused).
const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
	[],
	[],           // v1: no alignment patterns
	[6, 18],      // v2
	[6, 22],      // v3
	[6, 26],      // v4
	[6, 30],      // v5
	[6, 34],      // v6
	[6, 22, 38],  // v7
	[6, 24, 42],  // v8
	[6, 26, 46],  // v9
	[6, 28, 52],  // v10
];

// Penalty score weights (ISO/IEC 18004 section 6.8.2.1).
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/*---- Bit stream and segment helpers ----*/

// Number of bits in the byte-mode character count field for the given version.
function charCountBits(version: number): number {
	return version <= 9 ? 8 : 16;
}

// Number of data codewords (excluding ECC) for the given version at level M.
function getNumDataCodewords(version: number): number {
	return TOTAL_CODEWORDS[version] -
		ECC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version];
}

// Appends the len lowest-order bits of val to the bit array, most significant first.
function appendBits(val: number, len: number, bits: number[]): void {
	for (let i = len - 1; i >= 0; i--)
		bits.push((val >>> i) & 1);
}

/**
 * Encodes a string as UTF-8 and returns the byte values (0-255).
 * Exported for testing.
 */
export function encodeUtf8(text: string): number[] {
	const out: number[] = [];
	for (const ch of text) {
		const cp: number = ch.codePointAt(0) as number;
		if (cp < 0x80)
			out.push(cp);
		else if (cp < 0x800)
			out.push(
				0xC0 | (cp >>> 6),
				0x80 | (cp & 0x3F));
		else if (cp < 0x10000)
			out.push(
				0xE0 | (cp >>> 12),
				0x80 | ((cp >>> 6) & 0x3F),
				0x80 | (cp & 0x3F));
		else
			out.push(
				0xF0 | (cp >>> 18),
				0x80 | ((cp >>> 12) & 0x3F),
				0x80 | ((cp >>> 6) & 0x3F),
				0x80 | (cp & 0x3F));
	}
	return out;
}

/*---- Reed-Solomon error correction over GF(2^8) ----*/

/**
 * Multiplies two elements of GF(2^8) with the reducing polynomial
 * x^8 + x^4 + x^3 + x^2 + 1 (0x11D). Exported for testing;
 * e.g. gfMultiply(2, 128) === 29.
 */
export function gfMultiply(x: number, y: number): number {
	if (x >>> 8 !== 0 || y >>> 8 !== 0)
		throw new Error("Byte out of range");
	// Russian peasant multiplication with modular reduction.
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11D);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

// Returns the Reed-Solomon generator polynomial for the given degree,
// as coefficients from highest to lowest order, excluding the leading 1 term.
function reedSolomonComputeDivisor(degree: number): number[] {
	if (degree < 1 || degree > 255)
		throw new Error("Degree out of range");
	// Polynomial is product of (x - r^i) for i = 0 to degree-1, where r = 0x02.
	const result: number[] = [];
	for (let i = 0; i < degree - 1; i++)
		result.push(0);
	result.push(1); // Start with the monomial x^0

	let root = 1;
	for (let i = 0; i < degree; i++) {
		// Multiply the current product by (x - root).
		for (let j = 0; j < result.length; j++) {
			result[j] = gfMultiply(result[j], root);
			if (j + 1 < result.length)
				result[j] ^= result[j + 1];
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

// Returns the Reed-Solomon error correction codewords for the given data and divisor.
function reedSolomonComputeRemainder(data: readonly number[], divisor: readonly number[]): number[] {
	const result: number[] = divisor.map(() => 0);
	for (const b of data) { // Polynomial division
		const factor: number = b ^ (result.shift() as number);
		result.push(0);
		divisor.forEach((coef, i) => {
			result[i] ^= gfMultiply(coef, factor);
		});
	}
	return result;
}

// Splits the data codewords into blocks, computes ECC for each block,
// and interleaves the bytes into a single sequence (ISO/IEC 18004 section 6.6).
function addEccAndInterleave(data: readonly number[], version: number): number[] {
	if (data.length !== getNumDataCodewords(version))
		throw new Error("Invalid argument");

	const numBlocks: number = NUM_ERROR_CORRECTION_BLOCKS[version];
	const blockEccLen: number = ECC_CODEWORDS_PER_BLOCK[version];
	const rawCodewords: number = TOTAL_CODEWORDS[version];
	const numShortBlocks: number = numBlocks - rawCodewords % numBlocks;
	const shortBlockLen: number = Math.floor(rawCodewords / numBlocks);

	// Split data into blocks and append ECC to each block.
	const blocks: number[][] = [];
	const rsDiv: number[] = reedSolomonComputeDivisor(blockEccLen);
	for (let i = 0, k = 0; i < numBlocks; i++) {
		const dat: number[] = data.slice(
			k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
		k += dat.length;
		const ecc: number[] = reedSolomonComputeRemainder(dat, rsDiv);
		if (i < numShortBlocks)
			dat.push(0); // Placeholder so all blocks have equal length below
		blocks.push(dat.concat(ecc));
	}

	// Interleave (not concatenate) the bytes from every block into a single sequence.
	const result: number[] = [];
	for (let i = 0; i < blocks[0].length; i++) {
		blocks.forEach((block, j) => {
			// Skip the padding byte in short blocks.
			if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
				result.push(block[i]);
		});
	}
	if (result.length !== rawCodewords)
		throw new Error("Assertion error");
	return result;
}

/*---- Format and version information ----*/

/**
 * Returns the 15 format information bits (with mask applied) for error
 * correction level M and the given mask pattern (0-7), using the
 * BCH(15,5) code. Exported for testing; formatInfoBits(0) === 0x5412,
 * i.e. the bit string 101010000010010.
 */
export function formatInfoBits(mask: number): number {
	if (mask < 0 || mask > 7)
		throw new Error("Mask out of range");
	const data: number = (ECC_FORMAT_BITS << 3) | mask;
	// BCH(15,5) remainder with generator polynomial
	// x^10 + x^8 + x^5 + x^4 + x^2 + x + 1 (0x537).
	let rem: number = data;
	for (let i = 0; i < 10; i++)
		rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	const bits: number = ((data << 10) | rem) ^ 0x5412; // Fixed XOR mask
	if (bits >>> 15 !== 0)
		throw new Error("Assertion error");
	return bits;
}

/**
 * Returns the 18 version information bits for the given version (7-40),
 * using the BCH(18,6) code with generator polynomial
 * x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1 (0x1F25).
 * Exported for testing.
 */
export function versionInfoBits(version: number): number {
	if (version < 7 || version > 40)
		throw new Error("Version out of range for version info");
	let rem: number = version;
	for (let i = 0; i < 12; i++)
		rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
	const bits: number = (version << 12) | rem;
	if (bits >>> 18 !== 0)
		throw new Error("Assertion error");
	return bits;
}

/*---- Matrix construction ----*/

// Returns true iff the i'th bit of x is set to 1.
function getBit(x: number, i: number): boolean {
	return ((x >>> i) & 1) !== 0;
}

// Mutable drawing state for one symbol. x is the column, y is the row
// (matching Project Nayuki's coordinate convention); grids are indexed [y][x].
interface Canvas {
	readonly size: number;
	readonly modules: boolean[][];    // true = dark
	readonly isFunction: boolean[][]; // true = function module (not maskable)
}

function setFunctionModule(c: Canvas, x: number, y: number, isDark: boolean): void {
	c.modules[y][x] = isDark;
	c.isFunction[y][x] = true;
}

// Draws two copies of the format bits (with the given mask applied),
// plus the always-dark module, based on ISO/IEC 18004 section 7.9.
function drawFormatBits(c: Canvas, mask: number): void {
	const bits: number = formatInfoBits(mask);

	// Draw first copy (around the top-left finder pattern).
	for (let i = 0; i <= 5; i++)
		setFunctionModule(c, 8, i, getBit(bits, i));
	setFunctionModule(c, 8, 7, getBit(bits, 6));
	setFunctionModule(c, 8, 8, getBit(bits, 7));
	setFunctionModule(c, 7, 8, getBit(bits, 8));
	for (let i = 9; i < 15; i++)
		setFunctionModule(c, 14 - i, 8, getBit(bits, i));

	// Draw second copy (split between bottom-left and top-right).
	for (let i = 0; i < 8; i++)
		setFunctionModule(c, c.size - 1 - i, 8, getBit(bits, i));
	for (let i = 8; i < 15; i++)
		setFunctionModule(c, 8, c.size - 15 + i, getBit(bits, i));
	setFunctionModule(c, 8, c.size - 8, true); // Always dark module
}

// Draws two copies of the version bits for versions 7 and above,
// based on ISO/IEC 18004 section 7.10.
function drawVersion(c: Canvas, version: number): void {
	if (version < 7)
		return;
	const bits: number = versionInfoBits(version);
	for (let i = 0; i < 18; i++) {
		const bit: boolean = getBit(bits, i);
		const a: number = c.size - 11 + i % 3;
		const b: number = Math.floor(i / 3);
		setFunctionModule(c, a, b, bit);
		setFunctionModule(c, b, a, bit);
	}
}

// Draws a 9x9 finder pattern including the border separator,
// with the center module at (x, y). Modules outside the symbol are skipped.
function drawFinderPattern(c: Canvas, x: number, y: number): void {
	for (let dy = -4; dy <= 4; dy++) {
		for (let dx = -4; dx <= 4; dx++) {
			const dist: number = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance
			const xx: number = x + dx;
			const yy: number = y + dy;
			if (0 <= xx && xx < c.size && 0 <= yy && yy < c.size)
				setFunctionModule(c, xx, yy, dist !== 2 && dist !== 4);
		}
	}
}

// Draws a 5x5 alignment pattern with the center module at (x, y).
function drawAlignmentPattern(c: Canvas, x: number, y: number): void {
	for (let dy = -2; dy <= 2; dy++)
		for (let dx = -2; dx <= 2; dx++)
			setFunctionModule(c, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
}

// Draws all function patterns: timing, finders + separators, alignment
// patterns, and reserves the format/version areas (format drawn with dummy mask).
function drawFunctionPatterns(c: Canvas, version: number): void {
	// Timing patterns.
	for (let i = 0; i < c.size; i++) {
		setFunctionModule(c, 6, i, i % 2 === 0);
		setFunctionModule(c, i, 6, i % 2 === 0);
	}

	// Finder patterns (top-left, top-right, bottom-left), overwriting some timing modules.
	drawFinderPattern(c, 3, 3);
	drawFinderPattern(c, c.size - 4, 3);
	drawFinderPattern(c, 3, c.size - 4);

	// Alignment patterns, skipping the three corners occupied by finder patterns.
	const alignPos: readonly number[] = ALIGNMENT_POSITIONS[version];
	const numAlign: number = alignPos.length;
	for (let i = 0; i < numAlign; i++) {
		for (let j = 0; j < numAlign; j++) {
			if (!((i === 0 && j === 0) ||
					(i === 0 && j === numAlign - 1) ||
					(i === numAlign - 1 && j === 0)))
				drawAlignmentPattern(c, alignPos[i], alignPos[j]);
		}
	}

	// Reserve/draw format bits (dummy mask value; overwritten later) and version info.
	drawFormatBits(c, 0);
	drawVersion(c, version);
}

// Draws the given sequence of 8-bit codewords onto the data area of the
// symbol in the zigzag order defined by ISO/IEC 18004 section 7.7.3.
function drawCodewords(c: Canvas, data: readonly number[]): void {
	let i = 0; // Bit index into the data
	// Do the funny zigzag scan.
	for (let right = c.size - 1; right >= 1; right -= 2) { // Index of right column in each column pair
		if (right === 6)
			right = 5;
		for (let vert = 0; vert < c.size; vert++) { // Vertical counter
			for (let j = 0; j < 2; j++) {
				const x: number = right - j; // Actual x coordinate
				const upward: boolean = ((right + 1) & 2) === 0;
				const y: number = upward ? c.size - 1 - vert : vert; // Actual y coordinate
				if (!c.isFunction[y][x] && i < data.length * 8) {
					c.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
					i++;
				}
				// If this QR Code has any remainder bits (0 to 7), they were assigned as
				// 0/light by the constructor and are left unchanged by this method.
			}
		}
	}
	if (i !== data.length * 8)
		throw new Error("Assertion error");
}

// Returns true iff the mask pattern inverts the module at column x, row y.
function maskBit(mask: number, x: number, y: number): boolean {
	switch (mask) {
		case 0: return (x + y) % 2 === 0;
		case 1: return y % 2 === 0;
		case 2: return x % 3 === 0;
		case 3: return (x + y) % 3 === 0;
		case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5: return (x * y) % 2 + (x * y) % 3 === 0;
		case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
		case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
		default: throw new Error("Mask out of range");
	}
}

// XORs the codeword modules of the symbol with the given mask pattern.
// Calling this with the same mask twice is a no-op (self-inverse).
function applyMask(c: Canvas, mask: number): void {
	for (let y = 0; y < c.size; y++) {
		for (let x = 0; x < c.size; x++) {
			if (!c.isFunction[y][x] && maskBit(mask, x, y))
				c.modules[y][x] = !c.modules[y][x];
		}
	}
}

/*---- Penalty score calculation (ISO/IEC 18004 section 6.8.2.1) ----*/

// Pushes the given run length onto the run history (a 7-element array),
// treating position 0 as most recent. The leftmost/topmost run is padded
// with the light border, per Nayuki's finderPenaltyAddHistory.
function finderPenaltyAddHistory(size: number, currentRunLength: number, runHistory: number[]): void {
	if (runHistory[0] === 0)
		currentRunLength += size; // Add light border to initial run
	for (let i = 6; i >= 1; i--)
		runHistory[i] = runHistory[i - 1];
	runHistory[0] = currentRunLength;
}

// Counts finder-like patterns 1:1:3:1:1 with light borders of >= 4 on either side.
function finderPenaltyCountPatterns(runHistory: readonly number[]): number {
	const n: number = runHistory[1];
	const core: boolean = n > 0 && runHistory[2] === n &&
		runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
	return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
		(core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
}

// Terminates the current run at the edge of the symbol and counts patterns.
function finderPenaltyTerminateAndCount(
		size: number, currentRunColor: boolean, currentRunLength: number,
		runHistory: number[]): number {
	if (currentRunColor) { // Terminate dark run
		finderPenaltyAddHistory(size, currentRunLength, runHistory);
		currentRunLength = 0;
	}
	currentRunLength += size; // Add light border to final run
	finderPenaltyAddHistory(size, currentRunLength, runHistory);
	return finderPenaltyCountPatterns(runHistory);
}

// Calculates and returns the penalty score of the current module pattern.
// Lower is better; used to select the best mask.
function getPenaltyScore(c: Canvas): number {
	let result = 0;
	const size: number = c.size;

	// Adjacent modules in a row having the same color, and finder-like patterns in rows.
	for (let y = 0; y < size; y++) {
		let runColor = false;
		let runX = 0;
		const runHistory: number[] = [0, 0, 0, 0, 0, 0, 0];
		for (let x = 0; x < size; x++) {
			if (c.modules[y][x] === runColor) {
				runX++;
				if (runX === 5)
					result += PENALTY_N1;
				else if (runX > 5)
					result++;
			} else {
				finderPenaltyAddHistory(size, runX, runHistory);
				if (!runColor)
					result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
				runColor = c.modules[y][x];
				runX = 1;
			}
		}
		result += finderPenaltyTerminateAndCount(size, runColor, runX, runHistory) * PENALTY_N3;
	}

	// Adjacent modules in a column having the same color, and finder-like patterns in columns.
	for (let x = 0; x < size; x++) {
		let runColor = false;
		let runY = 0;
		const runHistory: number[] = [0, 0, 0, 0, 0, 0, 0];
		for (let y = 0; y < size; y++) {
			if (c.modules[y][x] === runColor) {
				runY++;
				if (runY === 5)
					result += PENALTY_N1;
				else if (runY > 5)
					result++;
			} else {
				finderPenaltyAddHistory(size, runY, runHistory);
				if (!runColor)
					result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
				runColor = c.modules[y][x];
				runY = 1;
			}
		}
		result += finderPenaltyTerminateAndCount(size, runColor, runY, runHistory) * PENALTY_N3;
	}

	// 2x2 blocks of modules having the same color.
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const color: boolean = c.modules[y][x];
			if (color === c.modules[y][x + 1] &&
					color === c.modules[y + 1][x] &&
					color === c.modules[y + 1][x + 1])
				result += PENALTY_N2;
		}
	}

	// Balance of dark and light modules.
	let dark = 0;
	for (const row of c.modules)
		for (const cell of row)
			if (cell)
				dark++;
	const total: number = size * size;
	// Find smallest k such that (45 - 5k)% <= dark/total <= (55 + 5k)%.
	const k: number = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
	result += k * PENALTY_N4;
	return result;
}

/*---- Top-level matrix assembly ----*/

// Builds the complete module matrix from the interleaved codewords:
// function patterns, data placement, and automatic mask selection.
function buildMatrix(allCodewords: readonly number[], version: number): boolean[][] {
	const size: number = 21 + (version - 1) * 4;
	const modules: boolean[][] = [];
	const isFunction: boolean[][] = [];
	for (let i = 0; i < size; i++) {
		modules.push(new Array<boolean>(size).fill(false));
		isFunction.push(new Array<boolean>(size).fill(false));
	}
	const c: Canvas = {size, modules, isFunction};

	drawFunctionPatterns(c, version);
	drawCodewords(c, allCodewords);

	// Try all 8 masks and pick the one with the lowest penalty score.
	let bestMask = 0;
	let minPenalty: number = Infinity;
	for (let mask = 0; mask < 8; mask++) {
		applyMask(c, mask);
		drawFormatBits(c, mask);
		const penalty: number = getPenaltyScore(c);
		if (penalty < minPenalty) {
			minPenalty = penalty;
			bestMask = mask;
		}
		applyMask(c, mask); // Undo the mask due to XOR being self-inverse
	}
	applyMask(c, bestMask);
	drawFormatBits(c, bestMask);

	return modules;
}
