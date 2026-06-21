// 배포용 dist/ 생성: 공개해도 되는 정적 파일만 복사한다.
// (.prompts/·test/·tools/·serve.mjs·package.json 등 개발 파일은 제외 → 사진/스크래치 비공개)
// 실행: node tools/build-dist.mjs
import { rm, mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = root + 'dist/';

// 배포에 포함할 항목(파일 또는 폴더)
const PUBLIC = [
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'sw.js',
  'src', // app.js, time.js, store.js
  'icons', // icon.svg, icon-16/32/192/512.png
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of PUBLIC) {
  await cp(root + entry, dist + entry, { recursive: true });
}
console.log('dist/ 생성 완료 →', PUBLIC.join(', '));
