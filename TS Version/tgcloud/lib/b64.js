// base64 دستی (در isolate مطمئن نیستیم atob/btoa/Buffer باشن)
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const R = new Uint8Array(128).fill(255);
for (let i = 0; i < 64; i++) R[A.charCodeAt(i)] = i;

export function b64encode(u8) {
  const parts = []; let out = ''; const n = u8.length; let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += A[v >> 18] + A[(v >> 12) & 63] + A[(v >> 6) & 63] + A[v & 63];
    if (out.length > 8192) { parts.push(out); out = ''; }
  }
  const rem = n - i;
  if (rem === 1) { const v = u8[i] << 16; out += A[v >> 18] + A[(v >> 12) & 63] + '=='; }
  else if (rem === 2) { const v = (u8[i] << 16) | (u8[i + 1] << 8); out += A[v >> 18] + A[(v >> 12) & 63] + A[(v >> 6) & 63] + '='; }
  parts.push(out);
  return parts.join('');
}

export function b64decode(s) {
  let n = s.length;
  while (n > 0 && s[n - 1] === '=') n--;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < n; i++) {
    const code = s.charCodeAt(i);
    const c = code < 128 ? R[code] : 255;
    if (c === 255) continue;
    buf = (buf << 6) | c; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; buf &= (1 << bits) - 1; }
  }
  return out.subarray(0, o);
}

export function concat(chunks) {
  let total = 0; for (const c of chunks) total += c.length;
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
