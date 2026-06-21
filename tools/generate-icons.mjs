// 0-의존성 PNG 생성기. 모래시계(타이머) 실루엣을 그려 아이콘 + OG 미리보기 이미지를 출력.
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
function encodePng(W, H, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = W * 4;
  const raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── 그리기: 세로 그라데이션 배경 + 모래시계(높이 기준으로 비례, 가로 중앙) ──
function draw(W, H = W) {
  const buf = Buffer.alloc(W * H * 4);
  const set = (x, y, r, g, b) => {
    const i = (y * W + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  };
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);

  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) set(x, y, lerp(0x18, 0x0f, t), lerp(0x20, 0x12, t), lerp(0x3d, 0x20, t));
  }

  const cx = W / 2;
  const y0 = H * 0.26, y1 = H * 0.74, ymid = (y0 + y1) / 2;
  const wTop = H * 0.42, neck = H * 0.045, capH = H * 0.045;
  const halfAt = (y) => {
    if (y < y0 || y > y1) return -1;
    if (y <= ymid) { const t = (y - y0) / (ymid - y0); return (wTop / 2) * (1 - t) + (neck / 2) * t; }
    const t = (y - ymid) / (y1 - ymid); return (neck / 2) * (1 - t) + (wTop / 2) * t;
  };
  const [r, g, b] = [0x34, 0xd3, 0x99];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
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
for (const N of [16, 32, 192, 512]) {
  writeFileSync(ICONS_DIR + `icon-${N}.png`, encodePng(N, N, draw(N, N)));
  console.log(`icons/icon-${N}.png 생성`);
}
// 링크 미리보기(Open Graph)용 1200×630 배너
writeFileSync(ICONS_DIR + 'og-image.png', encodePng(1200, 630, draw(1200, 630)));
console.log('icons/og-image.png 생성 (1200×630)');
