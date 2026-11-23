# Antigravity 에이전트 작업 규칙 — 스모크 존 레이더

## 프로젝트 성격
- 빌드 도구 없는 정적 웹앱이다 (HTML + CSS + 바닐라 JS + Leaflet). React/Vite 등 프레임워크를 새로 도입하지 말 것.
- 화면은 모바일 우선. 글자 16px 이상, 누르는 버튼은 44×44px 이상을 유지할 것.
- 지도 라이브러리는 `assets/vendor/leaflet/`에 들어 있는 로컬 파일을 쓴다. CDN으로 바꾸지 말 것.

## 데이터 규칙 (가장 중요)
- `data/smoking-areas.js`, `data/no-smoking-points.js`의 좌표를 **AI가 추정해서 채우거나 고치지 말 것.**
  좌표는 공공데이터 원본 또는 `tools/geocode_kakao.rb`(카카오 API) 결과만 쓴다.
- 새 흡연구역·금연구역 데이터를 추가할 때는 파일 맨 위 주석에 출처와 내려받은 날짜를 적는다.
- 법·과태료 문구는 "과태료 최대 10만원", "대략적인 범위", "현장 표지판이 우선"처럼 단정하지 않는 표현을 유지한다.

## 비밀 정보
- 카카오 REST API 키 등 키 값을 코드나 파일에 직접 적지 말 것. 환경변수(`KAKAO_REST_KEY`)로만 쓴다.
- `.env` 파일은 `.gitignore`에 있으므로 커밋하지 않는다.

## 확인 방법
- 로컬 실행: `ruby server.rb` → http://localhost:3000
- 상단 🚶 시뮬레이터를 켜고 지도를 탭해서 흡연구역 알림과 학교 근처 금연구역 경고가 뜨는지 확인한다.
- 브라우저 콘솔에 오류가 없어야 한다.

## 배포
- GitHub `main` 브랜치에 push하면 Netlify가 `netlify.toml` 설정대로 자동 배포한다.
- 사이트에 올라가는 파일: `index.html`, `sw.js`, `manifest.webmanifest`, `assets/`, `data/` (나머지는 저장소에만 있음).
- 커밋 메시지는 한국어로, 무엇을 바꿨는지 한 줄로 적는다.
