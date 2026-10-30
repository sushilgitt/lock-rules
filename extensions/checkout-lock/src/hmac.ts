// Minimal HMAC-SHA256 for the Functions runtime, which has no crypto module and
// counts every instruction (limit: 11M per run, and one SHA-256 block costs ~1M
// under Javy). So the server precomputes the keyed "midstates" (see midstates())
// and a token check only hashes two blocks. Digests match Node's crypto and
// Liquid's hmac_sha256.

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const w = new Int32Array(64);

/** One SHA-256 compression: state (8 ints) + 64 bytes at bytes[off]. Returns the new state. */
function compress(state: number[], bytes: number[], off: number): number[] {
  for (let i = 0; i < 16; i++) {
    const j = off + 4 * i;
    w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15];
    const y = w[i - 2];
    w[i] =
      (w[i - 16] +
        (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) +
        w[i - 7] +
        (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) |
      0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const t1 =
      (h +
        (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) +
        ((e & f) ^ (~e & g)) +
        K[i] +
        w[i]) |
      0;
    const t2 =
      ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  return [
    (state[0] + a) | 0, (state[1] + b) | 0, (state[2] + c) | 0, (state[3] + d) | 0,
    (state[4] + e) | 0, (state[5] + f) | 0, (state[6] + g) | 0, (state[7] + h) | 0,
  ];
}

function ascii(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
  return out;
}

/** Finishes a hash of `prefixBlocks` already-absorbed 64-byte blocks plus `bytes` (a single remaining chunk). */
function finish(state: number[], prefixBlocks: number, bytes: number[]): number[] {
  const bits = (prefixBlocks * 64 + bytes.length) * 8;
  const msg = bytes.slice();
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  msg.push(0, 0, 0, 0, (bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff);
  let s = state;
  for (let off = 0; off < msg.length; off += 64) s = compress(s, msg, off);
  return s;
}

function stateBytes(s: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push((s[i] >>> 24) & 0xff, (s[i] >>> 16) & 0xff, (s[i] >>> 8) & 0xff, s[i] & 0xff);
  return out;
}

export type Midstates = { i: number[]; o: number[] };

/** Keyed inner/outer states for an ASCII key up to 64 bytes. The server stores these instead of the key. */
export function midstates(key: string): Midstates {
  const k = ascii(key);
  if (k.length > 64) throw new Error("HMAC key too long");
  while (k.length < 64) k.push(0);
  return { i: compress(IV, k.map((b) => b ^ 0x36), 0), o: compress(IV, k.map((b) => b ^ 0x5c), 0) };
}

const HEX = "0123456789abcdef";

/** HMAC-SHA256 of an ASCII message from precomputed midstates, as lowercase hex. */
export function hmacHex(mid: Midstates, message: string): string {
  const inner = finish(mid.i, 1, ascii(message));
  const bytes = stateBytes(finish(mid.o, 1, stateBytes(inner)));
  let hex = "";
  for (let i = 0; i < 32; i++) hex += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return hex;
}
