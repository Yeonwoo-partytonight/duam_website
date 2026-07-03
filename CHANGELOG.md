# CHANGELOG — 두암한방병원.html

> 이 저장소는 git으로 관리되지 않아, 아래 이력은 **백업본(.fuse_hidden ×9) diff · 파일 수정 타임스탬프 · 폰트샘플 파일(A/B)** 을 근거로 재구성했다.
> 정확한 시각이 확인되는 항목은 그대로, 근거는 있으나 시각이 불명확한 항목은 **(추정)** 으로 표기했다.
> 연락처(062-716-7160)·주소(광주 동구 갈마로 46)·진료시간 등 사실 정보는 임의로 변경하지 않았다.

## 요약

- 단일 HTML 파일 구조의 SPA 병원 사이트를 구축하고, **폰트 조합(A: Noto 계열 / B: IBM Plex + Nanum Myeongjo + Song Myung)** 을 실험한 뒤 **최종적으로 Noto 계열(디자인 토큰 표준)로 복귀**했다.
- 최신 개정에서 사이트 범위를 **정리·축소**했다: `face`(안면비대칭·여드름) 페이지 전면 삭제, `rehab`의 `exercise`(1:1 운동치료실) 삭제 및 `manual` 명칭 변경, `cancer` 클리닉을 2개 세부에서 **단일 개요 구조로 통합**.
- 병원소개(`about`)의 특수검사 항목을 실제 보유 장비 기준으로 **교체**(체성분·사상체질·혈액검사 → 골밀도검사·초음파)했다.
- ⚠️ 현재 [CLAUDE.md](CLAUDE.md)의 라우트 표는 삭제 전 구조(`face`, `rehab/exercise`, `cancer/womencancer·pancreatic`)를 아직 담고 있어 **실제 HTML과 불일치** — 문서 동기화 필요.

---

## 2026-06-26

- **[디자인/스타일]** 실험 폰트 조합을 **표준 Noto 계열로 원복**
  - 세부: `IBM Plex Sans KR → Noto Sans KR`(본문), `Nanum Myeongjo → Noto Serif KR`(로고·카드·CTA 제목), `Song Myung → Noto Serif KR`(페이지 히어로 제목). Google Fonts `<link>`도 Noto Sans KR / Noto Serif KR / DM Serif Display로 교체.
  - 영향: CLAUDE.md의 "기존 Google Fonts만 사용" 폰트 토큰 규칙과 일치. `<head>` 폰트 링크 1줄 갱신.

- **[레이아웃/구조][라우팅]** `face`(안면비대칭·여드름) 페이지 **전면 삭제**
  - 세부: `#/face/asymmetry`(안면비대칭·정안), `#/face/lifting`(매선·리프팅), `#/face/acne`(여드름) 3개 섹션과 페이지 히어로·서브내비 제거.
  - 영향: 드로어 메뉴 그룹(`data-page="face"`, `g6`) 및 관련 자식 링크 제거. 라우트 목록에서 `face` 완전 제외(현재 라우트: home/about/spine/rehab/accident/women/fatigue/cancer/news 9종).

- **[레이아웃/구조][라우팅]** `rehab`(수술 후 재활)에서 `exercise` 삭제 및 `manual` 명칭 변경
  - 세부: `#/rehab/exercise`(1:1 운동치료실) 서브내비·섹션·시설 카드·드로어 자식 링크 제거. `#/rehab/manual` 제목·메뉴 라벨 "정형도수 치료 → 도수치료"로 변경.
  - 영향: rehab 서브내비가 chuna/manual/herb/inpatient/equipment 5종으로 정리. 드로어 링크 동기화.

- **[레이아웃/구조][라우팅][콘텐츠]** `cancer`(암면역클리닉) 구조 **통합**
  - 세부: 기존 `#/cancer/womencancer`(여성암) + `#/cancer/pancreatic`(췌장암·담도암) 2개 세부 섹션 + 서브내비를 단일 `id="cancer-overview"` 개요 구조로 통합. 섹션 라벨 "암면역클리닉 → 암 자율신경 면역 클리닉"으로 변경.
  - 영향: 드로어가 부모 그룹(`g8`)에서 단독 링크(`.drawer-solo` → `#/cancer`)로 변경.

- **[콘텐츠]** 병원소개 특수검사/장비 항목 교체
  - 세부: `체성분 분석 → 골밀도검사`(골다공증·갱년기 골밀도 변화 확인), `사상체질 진단·기본 혈액검사 → 초음파`(근육·관절·연부조직, 방사선 노출 없음)로 info-card 내용 교체.
  - 영향: about 페이지 정보 카드 텍스트만 변경, 라우팅 영향 없음.

## 2026-06-25

- **[레이아웃/구조][콘텐츠]** 단일 HTML SPA 사이트 **기본 구축** *(추정 — 백업본 최초 스냅샷 기준)*
  - 세부: 해시 기반 라우팅(`.route` / `data-key`), 드로어 메뉴, 푸터, 다수 진료 페이지(home/about/spine/rehab/accident/women/face/fatigue/cancer/news)와 공용 컴포넌트(`.sec-title`·`.info-grid`·`.check-list`·`.cta-band`·`.page-hero`·`.subnav`·리빌 애니메이션 등) 구성.
  - 영향: 반응형(960/560px)·스크롤 리빌 포함한 전체 골격 확립.

- **[디자인/스타일]** 폰트 조합 A/B **실험** (16:29 백업 iteration ×8)
  - 세부: 별도 샘플 파일 `두암한방병원_A폰트샘플.html`(Noto Sans/Serif KR 계열)·`두암한방병원_B폰트샘플.html`(IBM Plex Sans KR + Nanum Myeongjo + Song Myung)로 두 조합을 비교. 본문에도 B 조합을 임시 적용해 여러 차례(폰트·소규모 텍스트) 저장.
  - 영향: 시각 실험 단계로, 최종 채택은 2026-06-26의 Noto 복귀.

- **[문서]** 프로젝트 가이드 문서 작성 (14:09)
  - 세부: [CLAUDE.md](CLAUDE.md)(작업 규칙·기술 제약·라우트 표)·[website-prompt.md](website-prompt.md) 생성.
  - 영향: 이후 모든 작업의 디자인 토큰·라우팅 규칙 기준.
