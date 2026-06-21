// 0-의존성 PNG 아이콘 생성기. 모래시계(타이머) 실루엣을 그려 icons/icon-{192,512}.png 출력.
// 실행: node tools/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ICONS_DIR = fileURLToPath(new URL('../icons/', import.meta.url));

// ── 최소 PNG 인코더 (RGBA, 8bit) ──
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
function encodePng(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = N * 4;
  const raw = Buffer.alloc((stride + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── 아이콘 픽셀 그리기 ──
function draw(N) {
  const buf = Buffer.alloc(N * N * 4);
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * N + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);

  // 배경 세로 그라데이션 (#18203d → #0f1220)
  for (let y = 0; y < N; y++) {
    const t = y / N;
    for (let x = 0; x < N; x++) set(x, y, lerp(0x18, 0x0f, t), lerp(0x20, 0x12, t), lerp(0x3d, 0x20, t));
  }

  // 모래시계 실루엣 (초록 #34d399)
  const cx = N / 2;
  const y0 = N * 0.26, y1 = N * 0.74, ymid = (y0 + y1) / 2;
  const wTop = N * 0.42, neck = N * 0.045, capH = N * 0.045;
  const halfAt = (y) => {
    if (y < y0 || y > y1) return -1;
    if (y <= ymid) { const t = (y - y0) / (ymid - y0); return (wTop / 2) * (1 - t) + (neck / 2) * t; }
    const t = (y - ymid) / (y1 - ymid); return (neck / 2) * (1 - t) + (wTop / 2) * t;
  };
  const [r, g, b] = [0x34, 0xd3, 0x99];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hw = halfAt(y);
      let on = hw > 0 && Math.abs(x - cx) <= hw;
      if ((y >= y0 - capH && y <= y0) || (y >= y1 && y <= y1 + capH)) {
        if (Math.abs(x - cx) <= wTop / 2) on = true; // 위/아래 마개
      }
      if (on) set(x, y, r, g, b);
    }
  }
  return buf;
}

mkdirSync(ICONS_DIR, { recursive: true });
for (const N of [192, 512]) {
  writeFileSync(ICONS_DIR + `icon-${N}.png`, encodePng(N, draw(N)));
  console.log(`icons/icon-${N}.png 생성`);
}
