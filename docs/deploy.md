# 배포 가이드

정적 PWA라 무료 HTTPS 정적 호스팅에 올리면 데스크톱·모바일에서 열리고 **설치**된다.

## 0. 자동 배포 (GitHub Actions → GitHub Pages, 권장)

`main` 에 **push 될 때마다** 자동으로 `dist/` 를 빌드해 GitHub Pages 에 올린다.
워크플로: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

**최초 1회 설정(필수):**
1. GitHub 저장소 → **Settings → Pages**
2. **Source** 를 **`GitHub Actions`** 로 선택(저장)
3. 이후 push 하면 Actions 탭에서 빌드·배포가 자동 실행됨
4. 배포 주소: `https://cfbcbg0208.github.io/countdown-timer/`

> 설정을 바꾸기 전 첫 실행은 "Pages 미설정"으로 실패할 수 있다. 위 2번을 마친 뒤
> Actions 탭에서 **Re-run** 하거나 아무 커밋이나 다시 push 하면 된다.

아래 Netlify Drop 은 GitHub 없이 빠르게 올릴 때의 **대안**이다.

---

# 대안: Netlify Drop (수동)

## 1. 배포용 폴더 만들기
```
node tools/build-dist.mjs
```
→ `dist/` 에 공개용 파일만 복사된다(.prompts·test·tools·serve.mjs 등 제외).

## 2. Netlify Drop 에 올리기
1. 브라우저로 https://app.netlify.com/drop 접속
2. 파일 탐색기에서 `dist` 폴더를 열기 (경로: `…/260621일075831_timer/dist`)
3. **`dist` 폴더를 드롭존에 드래그** → 약 10초 뒤 `https://랜덤이름.netlify.app` URL 발급
4. (선택) 로그인해 사이트를 보관하고 이름 변경

## 3. 설치하기
- **데스크톱(Chrome/Edge)**: 배포 URL 접속 → 주소창 오른쪽 **설치(⊕)** 또는 ⋮ → "앱 설치" → 바탕화면/시작메뉴에 아이콘
- **안드로이드(Chrome)**: 배포 URL 접속 → ⋮ → "앱 설치" / "홈 화면에 추가" → 홈에 아이콘, 첫 로드 후 **오프라인 동작**

## 4. 수정 후 재배포
`node tools/build-dist.mjs` 다시 실행 → `dist`를 Netlify Drop에 다시 드래그.
(나중에 GitHub 연동 시 push만으로 자동 배포로 바꿀 수 있음.)

## 참고
- 데이터(localStorage)는 **기기·출처(origin)별로 분리**된다. localhost에서 만든 타이머는
  netlify 주소로 넘어오지 않으며, 기기 간 동기화도 없다(현재 범위 밖).
- 모든 경로가 상대경로라 루트/하위경로 어디에 올려도 동작한다.
