# 가계부 앱 사전 조사와 구조 비교 기록 (2026-11-04)

## 작업 보고

**변경 요약**: Mac과 iPhone에서 함께 쓰는 가계부 앱을 만들기 전에 기존 앱의 기능, 동기화 방식, 기술 제약을 조사하고 구조 후보를 비교했다. 구조는 아직 확정하지 않았다. 누가 쓰는 앱인지에 따라 결론이 갈리기 때문이다.

**변경 파일**: 이 기록 파일만 새로 만들었다. 제품 코드, 프로젝트 생성, 의존성 설치는 하지 않았다.

**판단/결정**
- 병렬로 Aside 조사 3개(국내 앱, 해외 Mac·iPhone 앱, 기술 제약)를 돌렸고, 그 사실을 바탕으로 Fable 서브에이전트 1개가 구조를 처음부터 비교했다.
- 잠정 판단: 혼자 또는 둘이 쓰면 웹앱과 직접 운영 서버(후보 B). 위젯이나 오프라인 입력이 필수이거나 Swift 학습도 목적이면 SwiftUI와 iCloud(후보 A). 공개 출시면 A 또는 SwiftUI와 직접 운영 서버(후보 C).
- 탈락: 로컬 우선 동기화 엔진(동기화 자체가 큰 프로젝트가 됨), 파일을 Dropbox 등으로 공유하는 방식(버전 갈림과 파일 손상 사례).

**검증**
- 로컬 환경 확인: `xcodebuild -version`은 Xcode가 없어 실패했고, `security find-identity -v -p codesigning`은 인증서 0개였다. Swift 6.3, Node 24는 있고 Flutter는 없다.
- Aside 조사는 공개 페이지만 읽었다. 세션 ID: 국내 앱 `cGxhScrutbh11YrV`, 해외 앱 `DCPeJtnjVlg3kdRW`, 기술 제약 `LsJXSyQ9H298Ho1a`.
- 근거 한계: 해외 앱의 Reddit 인용은 상당수가 검색 결과 발췌다. App Store 웹 리뷰는 날짜가 보이지 않는 경우가 많다. 카드사 엑셀 제공은 2차 출처 기준이다. 단축어가 확인 없이 실행되는지는 iOS 버전별 보고가 엇갈린다.

**리스크/후속**
- 누가 쓰는 앱인지 확인이 먼저다. 다른 사람이 같은 장부에 입력하면 장부·구성원·작성자가 데이터 모델에 처음부터 들어가야 한다.
- 카드 결제 알림이 문자로 오는지 확인해야 한다. 앱 푸시와 알림톡은 단축어 메시지 자동화에 걸리지 않는다. 실패하면 자동 입력의 기대치를 엑셀 가져오기와 한 줄 입력으로 낮춘다.
- 후보 B를 고르면 iPhone 홈 화면 웹앱의 오프라인 입력과 데이터 유지를 먼저 검증한다.
- 후보 A를 고르면 SwiftData와 CloudKit을 한 화면으로 시험해 충돌 결과와 전파 지연을 측정한 뒤 데이터 모델을 확정한다.
- 카드사 엑셀 한 달치로 승인, 매입, 취소, 할부 표기가 상태 모델과 맞는지 확인한다.

---

## 부록 A. Fable 구조 비교 결과

### 후보 구조

| 후보 | 구조 | 기준 데이터 | 비용·운영 | 쉬워짐 | 어려워짐 |
|---|---|---|---|---|---|
| A | SwiftUI 단일 타깃 + SwiftData/CloudKit | 사용자 iCloud 비공개 DB(기기는 복제본) | $99/년, Xcode 15GB, Swift 학습, 서버 없음 | 오프라인, 위젯·App Intent, 생체잠금, 데이터가 애플 계정 안에 | 동기화 실패가 안 보임(last-writer-wins, 지연 미공개), unique 불가, SwiftData는 공유 불가 |
| B | 반응형 웹(PWA) + 직접 운영 Spring Boot/PostgreSQL | 서버 DB 하나 | VPS 또는 홈서버, 도메인·TLS. Supabase 무료로 대체 가능하나 백업 없음·일시정지 | 동기화 문제 자체가 없음(후잉 구조), 가족 계정, pg_dump, 문자 단축어와 웹훅, 맥 엑셀 가져오기, 코드베이스 하나 | 오프라인 입력은 큐를 직접 구현, 위젯·생체잠금 없음, App Store 불가(Capacitor 래핑으로 보완) |
| C | SwiftUI 클라이언트 + 직접 서버(REST) | 서버 DB | A와 B 비용, 코드베이스 둘 | 네이티브 UX와 공유·백업 모두 | 혼자 하기엔 일이 가장 많음. 첫 버전이 아니라 출시 단계 진화형 |
| D | 로컬 우선 SQLite + 동기화 서버(CRDT/이벤트 로그) | 기기별 로그 병합 | 최고 난도 | 완전 오프라인 | 탈락: 동기화 정합성이 곧 프로젝트가 됨. Actual의 되돌림·한 달 오류 사례가 증거 |
| E | 파일 하나를 iCloud Drive/Dropbox로 공유 | 파일 | 0 | 구현 쉬움 | 탈락: 버전 갈림·손상, 복구 수단 없음 |

### 상황별 추천

- **혼자:** B. 동기화를 애초에 만들지 않고, 주특기로 가장 빨리 쓸 수 있는 물건이 나오며, 자동입력·백업·엑셀 가져오기가 전부 표준 도구다. 뒤집는 조건: 잠금화면·위젯 입력이나 오프라인 입력이 필수이거나, Swift 학습 자체가 목적이면 A.
- **둘이 공유:** B. iCloud 경로는 SwiftData 공유 미지원이라 Core Data로 내려가야 하고, 그래도 누가 언제 바꿨는지 보여주기 어렵다. 서버면 계정·장부·권한·이력이 자연스럽다. 뒤집는 조건: 상대가 홈 화면 웹앱을 거부하면 Capacitor 래핑, 그래도 부족하면 C.
- **공개 출시:** A(공유 필요 시 Core Data+CloudKit) 또는 C. 갈림은 타인의 금융 데이터를 내 서버에 둘 책임이다. 무료 앱이면 데이터가 사용자 계정에 남는 A, 구독으로 운영할 거면 C. 혼자/둘 버전을 먼저 써보고 결정한다. 뒤집는 조건: 안드로이드 사용자를 받을 거면 A 탈락.

### 먼저 물을 질문

다른 사람이 같은 장부에 입력하게 할 것인가. 그렇다면 장부·구성원·작성자가 데이터 모델에 첫날부터 들어가야 한다. 단일 사용자 스키마를 나중에 멀티 테넌트로 바꾸는 작업이 가장 비싸다. 아니라면 모든 후보가 살아남고, 다음 질문(App Store 의향)이 네이티브와 웹을 가른다.

### 구조와 무관한 데이터 모델 결정

- **장부 방식:** 입력은 단식, 저장은 거래 헤더와 분개 라인으로 된 경량 복식. 지출은 라인 1개(계좌 차감, 카테고리), 분할은 라인 N개, 이체는 라인 2개(카테고리 없음). 헤더 삭제가 라인을 함께 지워 이체 한쪽만 삭제되는 일이 없고, 통계는 카테고리 있는 라인만 합산해 이체가 합계를 부풀리지 않는다. 완전 복식 입력은 이탈 1순위인 입력 귀찮음을 키우므로 비권장.
- **금액:** 정수 원(long). float 금지. 통화 코드 컬럼만 미리 둔다.
- **카드:** 부채 계좌로 본다. 결제는 카드 계좌의 지출, 카드대금은 은행에서 카드로의 이체. 이중 집계가 없다.
- **할부:** 실제 거래 1건(총액, 결제일)에 개월 수·청구 시작월 메타. 월별 분할은 계산으로 보여주고 행을 미리 만들지 않는다. 발생 기준과 청구 기준 보기를 토글한다.
- **환불:** 원 거래를 참조하는 음수 지출(같은 카테고리). 수입이 아니다.
- **승인·매입·취소:** 상태 PENDING에서 POSTED(금액 수정 허용) 또는 CANCELED로 이동. 취소는 삭제가 아닌 상태 변경으로 남겨 보이게 하고 통계에서 제외.
- **문자 초안:** source, raw_text, source_key를 보존. 초안도 합계에 포함하되 미확인 표시와 검토 큐를 둔다. 파서는 생성만 하고 기존 행을 갱신하지 않는다.
- **중복:** 자동입력은 source_key(발신자, 금액, 분 단위 시각, 가맹점의 해시)에 unique. 수기는 같은 금액·가맹점·수 분 내 경고만. CloudKit은 unique가 없어 앱 수준에서 검사.
- **날짜:** 사용자가 고른 날짜(occurred_on, 날짜형)를 집계 키로 별도 저장. 타임스탬프에서 유도하지 않는다.
- **ID·삭제:** 기기에서 생성한 UUID(v7). 서버 upsert가 멱등해 오프라인 큐와 재시도가 안전. 소프트 삭제(deleted_at). version으로 낡은 쓰기를 조용히 덮지 않고 거부·표시.
- **장부·작성자:** 혼자 써도 ledger_id, created_by, device_id를 첫날부터 둔다.
- **복구:** append-only 변경 이력(전/후 값), 매일 자동 내보내기(CSV/JSON)를 사용자 소유 위치에 저장, 그 파일로 복원. UI에 마지막 동기화 시각과 대기 건수를 항상 표시.

### 일찍 검증할 위험

1. 카드 알림이 문자인가. 앱 푸시·카카오 알림톡 비중이 크다(추정). 본인 카드별 채널을 확인하고, 실기기에서 자동화가 확인 없이 전송까지 가는지 1건 시험한다.
2. (B) iOS PWA 오프라인 큐: 비행기 모드 입력 후 복귀 전송, 며칠 방치 후 로컬 데이터 생존, 홈 화면 아이콘에서 입력창까지의 체감 시간.
3. (A) SwiftData+CloudKit 1화면 스파이크: 두 기기에서 같은 레코드를 오프라인으로 다르게 수정한 결과와 전파 지연 측정. 무료 Personal Team 7일 만료를 한 번 겪고 $99 여부 결정.
4. 카드사 엑셀 한 달치로 승인/매입/취소/할부 표기를 확인.

---

## 부록 B. 국내 가계부 앱 조사 (Aside 세션 cGxhScrutbh11YrV)

조사를 끝냈어요. 공개 페이지만 읽었고 로그인이나 설치, 글 작성은 하지 않았어요(2026-11-04 기준).

**먼저 알아둘 점:** 편한가계부와 머니매니저(Money Manager)는 같은 앱이에요. 둘 다 (주)리얼바이트 앱이고, 한국 스토어 이름이 '편한가계부'예요([App Store](https://apps.apple.com/kr/app/id560481810), [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko)). 그래서 한 섹션으로 묶었어요. 대신 추가 앱 2개를 넣었어요.
- **위플 가계부, 꼬박가계부:** 추천 글과 커뮤니티에서 가장 자주 나와서 골랐어요.
- **브로콜리:** 추천 글에 자주 나오지만 개발사가 2020년에 폐업했고 스토어 페이지도 404라서 뺐어요([THE VC](https://thevc.kr/moneylabs/products)).

---

#### 1. 편한가계부 = 머니매니저 (리얼바이트)

| 항목 | 내용 | 출처 |
|---|---|---|
| 수기 입력 | 있음. 음성 입력("맥주 이만원")과 계산기도 있음 | [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko) |
| 문자/알림 인식 | **안드로이드만 자동**. 아이폰은 문자 복사-붙여넣기나 단축어로 하는 반자동 방식 | [공식](https://ko.realbyteapps.com/), [개발사 답변](https://apps.apps.appfollow.io/ios/pyeonhangagyebu/560481810?country=kr) |
| 영수증 | 사진 첨부만 됨. 인식(OCR) 기능은 미확인 | [App Store](https://apps.apple.com/kr/app/id560481810) |
| 금융사 자동연동 | 없음 | [블로그](https://zaezin.tistory.com/641) |
| 카테고리 | 직접 설정 가능, 소분류 있음 | [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko) |
| 자산 관리 | 복식부기 방식. 계좌·카드·현금·저축·보험·대출·부동산까지. 무료판은 자산 15개 제한 | [공식](https://ko.realbyteapps.com/) |
| 예산 / 통계 | 주·월·연 예산(분류별), 계좌별·거래처별 통계. PC판에는 보고서가 더 있음 | [App Store](https://apps.apple.com/kr/app/id560481810) |
| 반복거래 / 할부 | 둘 다 있음. 일시불로 넣은 건은 나중에 할부로 바꿀 수 없음 | [도움말](https://help.realbyteapps.com/hc/ko/articles/360043328193), [블로그](https://m.blog.naver.com/yeonjinhada/223003638804) |
| 환불 | 전용 기능은 미확인. 공식 안내는 마이너스 금액으로 지출 입력 | [도움말](https://help.realbyteapps.com/hc/ko/articles/360016072013) |
| 이체 / 검색 / 태그 | 다 있음. 태그는 v4.13부터 | [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko) |
| 백업 / 내보내기 | 엑셀 내보내기·가져오기. 아이폰은 iCloud·Dropbox, 안드로이드는 구글드라이브 | [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko), [App Store](https://apps.apple.com/kr/app/id560481810) |
| 공유 | 계정 하나를 같이 쓰는 방식만 있음 | [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko) |
| 잠금 / 위젯 | 비밀번호와 Face ID 있음. 위젯은 안드로이드에 빠른 입력·카드실적용이 있고, iOS 위젯 세부는 미확인 | [App Store](https://apps.apple.com/kr/app/id560481810), [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree&hl=ko) |

**아이폰 + PC/Mac:** 둘 다 됨
- 설치형 'PC가계부'가 윈도우용과 맥용으로 따로 있고, 네이버 카페에서 배포해요([블로그](https://ceres84.tistory.com/entry/%ED%8E%B8%ED%95%9C%EA%B0%80%EA%B3%84%EB%B6%80-PC%EA%B0%80%EA%B3%84%EB%B6%80-%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%84%A4%EC%B9%98%EB%B0%A9%EB%B2%95)).
- 동기화는 로그인하면 자체 서버로 돼요. 무료·프리미엄은 **수동 동기화**이고, **구독해야 실시간·사진 동기화와 PC 전체 기능**을 써요([공식](https://ko.realbyteapps.com/)).
- 무료로 PC를 쓰면 시간 제한이 있어요. 후기마다 30분/1시간으로 달라서 정확한 값은 미확인이에요([블로그1](https://m.blog.naver.com/joanna9570/223141276441), [블로그2](https://m.blog.naver.com/yeonjinhada/222976323710)).
- 글로벌판 영문 도움말에는 "기기 간 동기화 미지원"이라고 돼 있어요. 한국판과 기능이 달라요([FAQ](https://help.realbyteapps.com/hc/en-us/articles/26009445731993-Can-we-sync-between-devices)).

**가격:** 무료(광고). 프리미엄은 9,900원 일회성. 구독은 월 2,900원 또는 연 24,000원(첫해 할인 있음)([공식](https://ko.realbyteapps.com/)). 아이폰과 안드로이드를 오가면 다시 사야 해요([도움말](https://help.realbyteapps.com/hc/en-us/articles/10669627915417-Do-we-need-to-repurchase-when-changing-device)).

**칭찬**
- "로그인만 하면 기기별로 동기화 확실히 되는 것!! 굿" ([App Store 리뷰](https://apps.apple.com/kr/app/id560481810?see-all=reviews&platform=iphone))
- "아이폰에서 기록하고 아이패드에서…1초 정도에 자동으로 동기화" (구독자, [클리앙 2022-04](https://www.clien.net/service/board/cm_iphonien/17189321))
- "2011년 5월에 처음 사용…가계부 쓰는 것이 몸에 배어서" ([App Store 리뷰](https://apps.apple.com/kr/app/id560481810?see-all=reviews&platform=iphone))

**불만 / 이탈 이유**
- "매번 인식도 못 해서 제가 직접 하나하나 입력하다가 그냥 포기하고 다른 어플로 갈아타려고요" (안드로이드, 2025-05). 개발사는 폰 재시작을 권할 수밖에 없다고 답했어요([Play](https://play.google.com/store/apps/details?hl=ko&id=com.realbyteapps.moneymanagerfree)).
- "예전에 사용하다가 입력이 귀찮아서 안쓰게 됐어요" (아이폰 사용자, [클리앙 2021-06](https://www.clien.net/service/board/cm_iphonien/16200401))
- "[동기화]가 수동이라는 점에서 아웃이네요" ([클리앙 2022-10](https://www.clien.net/service/board/cm_iphonien/17614243))
- "계정공유라 배우자 내꺼 구분이 자동으로 안돼서" ([블라인드 2023-03](https://www.teamblind.com/kr/post/%EB%B6%80%EB%B6%80-%EA%B0%80%EA%B3%84%EB%B6%80-%EA%B3%B5%EC%9C%A0%EC%96%B4%ED%94%8C-%EB%AD%90-%EC%8D%A8-z2Rearbf))

---

#### 2. 뱅크샐러드

| 항목 | 내용 | 출처 |
|---|---|---|
| 입력 | 마이데이터로 자동연동되고, 수기 입력도 됨(현금은 수기로만). 문자 인식과 영수증 인식은 미확인 | [Play](https://play.google.com/store/apps/details?id=com.rainist.banksalad2&hl=ko), [도움말](https://help.banksalad.com/155) |
| 카테고리 | 기본 142개, 추가·삭제·세부 카테고리 가능 | [도움말](https://help.banksalad.com/88), [디지털데일리](https://m.ddaily.co.kr/page/view/2026092309474867615) |
| 자산 / 예산 / 통계 | 다 있음. 카테고리별 예산, 하루 권장 예산, 월간 리포트 | [도움말](https://help.banksalad.com/update_2503) |
| 고정지출 | '고정비' 분류는 있음. 직접 반복 등록하는 기능은 미확인 | [공식](https://www.banksalad.com/articles/%EA%B0%80%EA%B3%84%EB%B6%80%EC%96%B4%ED%94%8C-%EC%B6%94%EC%B2%9C-%EC%93%B0%EB%8A%94%EB%B2%95-%EB%8F%88%EA%B4%80%EB%A6%AC) |
| 할부 | 있음. 다만 선결제한 할부는 직접 고쳐야 함 | [도움말](https://help.banksalad.com/267) |
| 환불 | 부분 지원. 결제 2~3일 뒤 취소(매입취소)는 반영이 안 돼 직접 삭제해야 함. '내역 합치기'로 상계는 가능 | [도움말](https://help.banksalad.com/769), [머니투데이](https://www.mt.co.kr/finance/2025/10/18/2025101611340542589) |
| 이체 | 계좌 입출금은 '이체'로 분류돼 수입·지출 합계에서 빠짐 | [도움말](https://help.banksalad.com/157) |
| 검색 / 메모·태그 | 있음 | [도움말](https://help.banksalad.com/update_2501), [App Store 리뷰](https://apps.apple.com/kr/app/id1195804784?see-all=reviews&platform=iphone) |
| 내보내기 | 엑셀, 한 번에 최대 1년 | [도움말](https://help.banksalad.com/207) |
| 공유 | **없음.** '우리집돈관리'가 2025-07-31에 종료됨 | [공지](https://help.banksalad.com/1124) |
| 잠금 / 위젯 | 둘 다 있음(예산·송금 위젯 등) | [블로그(공식)](https://m.blog.naver.com/banksalad/222500444403), [도움말](https://help.banksalad.com/update_2505) |

**아이폰 + PC/Mac:** 아이폰만 돼요(iOS 18 이상, [App Store](https://apps.apple.com/kr/app/id1195804784)). PC 버전은 없는 것으로 보여요([지식iN 2019](https://m.kin.naver.com/qna/dirs/40107/docs/340094224), [블로그 2024](https://mktstudy.tistory.com/48)). 데이터는 계정 기준으로 서버에 저장돼요. 다만 재설치하면 금융사 연동을 다시 걸어야 해요([도움말](https://help.banksalad.com/70)). 여러 기기에서 동시에 쓸 수 있는지는 미확인이에요.

**가격:** 무료(광고). 유료 멤버십은 찾지 못했어요(미확인). 수익은 대출·카드·보험 중개에서 나와요([이코노미스트](https://economist.co.kr/article/view/ecn202610210044)).

**칭찬**
- "카뱅연동 후에는 정말 99% 완벽해졌다" ([블로그 2020](https://m.blog.naver.com/leeqwe89/221792044762))
- "게으르고 시간이 없는 사람들에게는 아주 적합한 앱" ([블로그 2023](https://momorich.tistory.com/entry/%EA%B0%80%EA%B3%84%EB%B6%80%EC%96%B4%ED%94%8C-%EB%B1%85%ED%81%AC%EC%83%90%EB%9F%AC%EB%93%9C-%EC%82%AC%EC%9A%A9-%ED%9B%84%EA%B8%B0-%EB%8B%A8%EC%96%B8%EC%BB%A8%EB%8C%80-%EA%B0%80%EA%B3%84%EB%B6%80-%EC%96%B4%ED%94%8C-%EC%A4%91-%EC%B5%9C%EA%B3%A0))
- "문자 복사해서 붙여야 하는 번거로움 때문에…지워버렸는데…인생어플" ([App Store 리뷰](https://apps.apple.com/kr/app/id1195804784?see-all=reviews&platform=iphone))

**불만 / 이탈 이유**
- 금액이 틀림: "실제론 800원이 결제됐지만 승인내역인 1000원이 입력된다"([App Store 리뷰](https://apps.apple.com/kr/app/id1195804784?see-all=reviews&platform=iphone)). 할부와 포인트 할인 건을 정확히 못 불러와 다른 앱으로 옮긴 후기도 있어요([블로그 2025-01](https://everyday-it.tistory.com/entry/%EB%B1%85%ED%81%AC%EC%83%90%EB%9F%AC%EB%93%9C-%EA%B0%80%EA%B3%84%EB%B6%80)).
- "툭하면 연결 끊겨 있고 그거 다시 연결하려면 핸드폰과 씨름" ([블로그 2022](https://kani-kongi.tistory.com/entry/%EB%B1%85%ED%81%AC%EC%83%90%EB%9F%AC%EB%93%9C-%EA%B8%B0%EA%B3%84%EB%B6%80-%EC%A7%80%EC%B6%9C%EA%B4%80%EB%A6%AC-%EC%9E%90%EC%82%B0%EA%B4%80%EB%A6%AC-%EC%97%B0%EA%B8%88%EC%A1%B0%ED%9A%8C-%EC%86%8C%EB%B9%84%ED%8C%A8%ED%84%B4%EB%B6%84%EC%84%9D)). 2021년 기사는 연동 에러 때문에 순이용자가 115만에서 70만으로 줄었다고 썼어요([위키리크스한국](https://www.wikileaks-kr.org/news/articleView.html?idxno=111092)).
- "금융 상품 광고가 앱 곳곳에 있어서…거슬리더라고요". 이 사용자는 토스로 옮겼어요([블로그 2026-02](https://dijiteolnomadeuibagu.tistory.com/entry/%EC%8A%A4%EB%A7%88%ED%8A%B8%ED%8F%B0-%EA%B0%80%EA%B3%84%EB%B6%80-%EC%95%B1-4%EA%B0%9C-%EB%8F%8C%EB%A0%A4-%EC%93%B4-%ED%9B%84%EA%B8%B0-%EC%A7%84%EC%A7%9C-%EC%9E%98-%EC%93%B0%EB%8A%94-%EA%B1%B4-%EC%9D%B4%EA%B1%B0%EC%98%80%EB%8B%A4)). 보험 전화 영업을 직접 겪었다는 후기는 못 찾았어요(미확인).

---

#### 3. 후잉 (whooing, 복식부기 웹 가계부)

| 항목 | 내용 | 출처 |
|---|---|---|
| 입력 | 수기 입력에 '어썸박스' 자동완성이 붙어 있음. 문자는 반자동(안드로이드 SMS 입력기, 아이폰 단축어·웹훅)이라 임시저장소에서 직접 분류해야 함. 엑셀·CSV 업로드, Open API, MCP도 지원 | [도움말](https://whooing.com/help/tips/outside), [웹훅](https://whooing.com/help/tips/outside/webhook) |
| 자동연동 | **없음.** 공식 FAQ에 "아직 이런 기능을 제공하고 있지 않습니다"라고 나옴 | [FAQ](https://whooing.com/help/faqs/inserting/auto-insert) |
| 영수증 | 파일 첨부만 됨(건당 5개). 인식 기능은 미확인 | [매뉴얼 PDF](https://whooing.com/help/pdf) |
| 카테고리 | 계정 5개(고정) > 항목 > 아이템의 3단계 | [도움말](https://whooing.com/help/entries) |
| 자산 / 예산 / 리포트 | 다 있음. 리포트는 자산부채·손익·현금흐름표 등 | [매뉴얼 PDF](https://whooing.com/help/pdf) |
| 반복 / 할부 | 둘 다 있음. `**`로 반복, `//`로 할부(수수료율 입력 가능) | [도움말](https://whooing.com/help/reports/insert/tools) |
| 환불 / 이체 | 환불은 마이너스 거래로 상계. 이체는 자산 간 거래로 처리 | [FAQ](https://whooing.com/help/faqs/inserting) |
| 검색 / 태그 | 검색은 AND·제외·금액 조건까지 됨. 전용 태그는 없고 괄호 안에 적는 방식 | [매뉴얼 PDF](https://whooing.com/help/pdf) |
| 내보내기 | 엑셀. 유료 기간이 끝나도 다운로드 가능 | [FAQ](https://whooing.com/help/faqs) |
| 공유 | 부분적. 계정을 같이 쓰거나 읽기 전용 보고서 링크를 공유 | [매뉴얼 PDF](https://whooing.com/help/pdf) |
| 잠금 / 위젯 | 미확인 | |

**아이폰 + PC/Mac:** 반응형 웹이라 어디서든 돼요. 데스크톱 앱도 있다고 안내해요([소개](https://whooing.com/info/about), [FAQ](https://whooing.com/help/faqs/common/webapp)).
- 데이터가 서버(AWS)에 하나로 있어서 동기화 문제가 생길 구조가 아니에요.
- 공식 iOS 앱은 App Store에서 못 찾았어요(미확인). 안드로이드 앱과 비공식 iOS 앱 '머니페이퍼'는 있어요([Play](https://play.google.com/store/apps/details?hl=ko&id=com.whooing.app), [앱 목록](https://whooing.com/info/apps)).

**가격:** 월 3,900원, 연 39,780원, 10년 294,840원. 광고는 없어요. 기간이 끝나면 조회와 엑셀 다운로드만 돼요([홈](https://whooing.com/), [FAQ](https://whooing.com/help/faqs)). 무료 체험 기간은 한글 설명(1~3개월)과 영문 설명(6개월)이 서로 달라요.

**칭찬**
- "가장 좋은 점은 서비스의 지속성… 10년 넘게 사용" ([Play 리뷰](https://play.google.com/store/apps/details?hl=ko&id=com.whooing.app))
- "적응되고나니 이것만큼…돈의 흐름을 파악하기 쉬운 게 없습니다" ([블로그 2023](https://kongmks.tistory.com/700))
- "AWESOME BOX…자동완성해줘서 이젠 입력하는데 얼마 안걸린다" ([블로그 2024](https://rein.kr/posts/2024-07-30-whooing))

**불만 / 이탈 이유**
- "복식부기를 몰라서....매번 시도 실패" ([클리앙 2023-02](https://www.clien.net/service/board/park/17894768))
- "후잉은 부지런한 사람만 쓰는 가계부… 게을러서 잘 안 쓰게 되네요" ([공식 사이트 후기](https://whooing.com/))
- "단순 수입 지출 가계부로 사용하기에는 기능이 너무 많아서 외울게 많습니다" ([Play 리뷰](https://play.google.com/store/apps/details?hl=ko&id=com.whooing.app))

---

#### 4. 똑똑가계부 (클레베니)

| 항목 | 내용 | 출처 |
|---|---|---|
| 입력 | 수기, 문자(SMS/MMS) 인식, 앱 푸시 알림 인식(특허). 설치 전에 받은 문자도 등록 가능 | [Play](https://play.google.com/store/apps/details?id=com.dencreak.spbook&hl=ko), [매뉴얼](https://m.blog.naver.com/tui8018/221809830833) |
| 영수증 / 자동연동 | 영수증은 미확인. 금융사 연동은 없음(기기의 문자·알림만 읽음) | [Play](https://play.google.com/store/apps/details?id=com.dencreak.spbook&hl=ko) |
| 카테고리 | 직접 설정 가능. 한 번 간 가맹점은 자동 분류 | [매뉴얼](https://m.blog.naver.com/tui8018/221809830833) |
| 자산 관리 | 약함. "자산관리 기능은 너무 떨어져요"라는 평 | [클리앙](https://www.clien.net/service/board/cm_andro/9657325) |
| 예산 / 통계 | 둘 다 있음. 단 예산은 월 단위로 고정이라 월급일 기준으로 못 맞춤 | [Play](https://play.google.com/store/apps/details?id=com.dencreak.spbook&hl=ko) |
| 반복 / 할부 | 둘 다 있음 | [매뉴얼](https://m.blog.naver.com/tui8018/221809830833), [기사](https://www.junsungki.com/magazine/post-detail.do?id=2526) |
| 환불 | 있음. **승인취소 문자를 인식해 기록을 자동 삭제** | [블로그](https://soso-dreamer.tistory.com/236) |
| 이체 | 부분적. 카드대금은 지출에서 뺄 수 있음 | [매뉴얼](https://m.blog.naver.com/tui8018/221809830833) |
| 검색 / 백업 / 잠금 | 다 있음. 백업은 구글드라이브, 내보내기는 엑셀 | [Play](https://play.google.com/store/apps/details?id=com.dencreak.spbook&hl=ko) |
| 태그 / 위젯 / 공유 | 미확인. 공유는 데이터가 기기에만 저장돼서 사실상 없는 것으로 보임 | [매뉴얼](https://m.blog.naver.com/tui8018/221809830833) |

**아이폰 + PC/Mac:** **둘 다 안 돼요.** 안드로이드 전용이에요([공식](https://www.cleveni.com/clevmoney), [App Store 개발자 페이지](https://apps.apple.com/kr/developer/cleveni-inc/id1221235592)).
- App Store의 "편한가계부 - 똑똑가계부…"는 이름만 빌린 다른 개발자 앱이에요([링크](https://apps.apple.com/kr/app/id6444122615)).
- 동기화 서버가 없어요. 기기를 옮길 때 구글드라이브로 직접 백업하고 복구해요.

**가격:** 무료(광고)에 프리미엄 구독이 있어요. 2023년 기사 기준 월 2,900원이고([영남일보](https://www.yeongnam.com/web/view.php?key=20230727010003603)), 현재 금액은 미확인이에요.

**칭찬**
- "고정비는 즐겨찾기에 매월반복해놓으면…자동반복입력" (2026-03)
- "간단한 메모만 잘해두면 언제든 검색도 잘되고" (2026-09)
- 출처: 둘 다 [Play 리뷰](https://play.google.com/store/apps/details?id=com.dencreak.spbook&hl=ko)

**불만 / 이탈 이유** (모두 [Play 리뷰](https://play.google.com/store/apps/details?id=com.dencreak.spbook&hl=ko), 2026년)
- "재부팅을 해도 몇 번 입력되다가 다시 자동입력이 안되네요…다른 가계부 앱을 찾아봐야겠습니다" (07-27). 2026년 리뷰 대부분이 이 이야기예요. 개발사는 OS가 배터리 절약 때문에 알림 인식을 꺼버린다고 답했어요.
- 광고 문자의 쿠폰번호가 결제로 잡혀 "2천만원 카드 승인…모든 카드 분실 신고했는데" (07-09)
- "로그인하면 연동되는 다른어플과 똑같겠지하고 백업안하고…기록을 날려버렸네요" (09-13)

---

#### 5. 토스 (소비 기능)

| 항목 | 내용 | 출처 |
|---|---|---|
| 입력 | 연결한 계좌·카드 내역이 자동으로 모임. 현금은 수기로 등록 가능. 문자·영수증 인식은 미확인 | [공식](https://toss.im/service/asset-management), [블로그 2026-03](https://m.blog.naver.com/homemcomum/224224048455) |
| 카테고리 | 수정 가능(같은 가맹점 일괄 적용). 새 카테고리 생성 가능 | [모비인사이드](https://www.mobiinside.co.kr/2021/08/24/account-book-service/), [데일리팝](https://www.dailypop.kr/news/articleView.html?idxno=74964) |
| 예산 | '도전! 소비 줄이기'로 월 목표 설정. 카테고리별 예산은 블로그 주장만 있음 | [데일리팝](https://www.dailypop.kr/news/articleView.html?idxno=74964) |
| 통계 / 고정지출 | 소비 캘린더, 소비 분석, 고정 지출 메뉴, 또래 비교 | [공식](https://toss.im/service/asset-management) |
| 이체 | 내 계좌 간 이체와 카드대금은 자동 제외(2021 자료). 그 밖의 이체는 거래마다 '지출 합계에 포함'을 꺼야 함 | [브런치](https://brunch.co.kr/@mobiinside/3389), [FAQ](https://support.toss.im/faq/5035) |
| 메모 / 잠금 | 둘 다 있음 | [블로그](https://m.blog.naver.com/homemcomum/224224048455), [FAQ](https://support.toss.im/faq/3507) |
| 내보내기 / 공유 | **없음.** 엑셀도, 커플 공유도 안 됨 | [블로그 2026-03](https://m.blog.naver.com/homemcomum/224224048455) |
| 할부·태그·위젯·검색 | 미확인. 검색은 근거가 약함 | |

**아이폰 + PC/Mac:** 아이폰만 돼요([App Store](https://apps.apple.com/kr/app/id839333328)). toss.im 웹에서는 로그인해서 쓰는 기능을 지원하지 않는다는 블로그 근거만 있어요. 공식 FAQ로는 확인하지 못했어요([블로그](https://dragonwisdom.tistory.com/entry/토스-PC버전-이용하는-방법｜모바일-없이-계좌-확인·송금하는-팁)). 동기화 방식은 미확인이에요.

**가격:** 무료. 소비 기능에 유료 플랜이 없다는 근거는 블로그뿐이에요([블로그](https://j1epapablog.kr/blog/2026/05/21/)).

**칭찬**
- "유지 난이도가 제로다" ([블로그 2026](https://m.blog.naver.com/homemcomum/224224048455))
- "토스가 알아서 다 해준다는 게 편하더라고요" ([블로그 2023](https://jayuroad.tistory.com/57))
- "가계부 안써도 되서 너무 좋습니다" ([클리앙 2022](https://www.clien.net/service/board/park/17440314))

**불만 / 이탈 이유**
- "주식거래를…전부 지출로 잡혀 버렸다.(3천 7백만 원 소비라니..)" ([브런치 2021](https://brunch.co.kr/@mobiinside/3389))
- "같은 가맹점을 네다섯 번 고쳐줘야 인식이 안정되는 편" ([블로그 2026-05](https://j1epapablog.kr/blog/2026/05/21/))
- "간편했지만 지출 통계가 부족했습니다" ([블로그 2025](https://essay1685.tistory.com/entry/가계부-앱-뭐-쓸까-직접-써보고-비교해본-현실-후기))

---

#### 6. 위플 가계부 (추가)

| 항목 | 내용 | 출처 |
|---|---|---|
| 입력 | 수기, **한 줄 자연어 입력**("점심 12000"), 결제문자 붙여넣기, 카드앱 캡처 인식. 알림 자동 담기는 안드로이드만. 금융사 연동은 없음 | [도움말](https://withweple.com/help/), [Play](https://play.google.com/store/apps/details?id=com.weple.moneybook&hl=ko) |
| 카테고리 / 자산 | 카테고리 추가 가능. 계좌·카드·현금·대출 관리 | [Play](https://play.google.com/store/apps/details?id=com.weple.moneybook&hl=ko) |
| 예산 / 통계 | 둘 다 있음. 주간 예산과 연간 리포트는 Pro | [Play](https://play.google.com/store/apps/details?id=com.weple.moneybook&hl=ko) |
| 반복 / 할부 / 이체 구분 | 다 있음 | [Play](https://play.google.com/store/apps/details?id=com.weple.moneybook&hl=ko) |
| 검색 / 태그 / 잠금 | 다 있음 | [App Store](https://apps.apple.com/kr/app/id467936485) |
| 백업 / 내보내기 | iCloud·구글드라이브 자동 백업, CSV 내보내기 | [도움말](https://withweple.com/help/), [블로그](https://m.blog.naver.com/ssibar1188/224017748706) |
| 위젯 | Pro 기능(안드로이드 스토어 기준). iOS는 미확인 | [Play](https://play.google.com/store/apps/details?id=com.weple.moneybook&hl=ko) |
| 환불 / 공유 | 미확인 | |

**아이폰 + PC/Mac:** 아이폰은 되고, M1 이상 맥에서 아이폰 앱으로 실행할 수 있어요. PC 웹은 없고, 실시간 동기화 대신 백업/복원 방식이에요([App Store](https://apps.apple.com/kr/app/id467936485), [블로그](https://aerim9327.tistory.com/1512)). 안드로이드판은 2026-10에 나왔어요.

**가격:** 무료(광고). Pro는 월 2,500원, 연 16,000원, 평생 32,000원이에요([App Store](https://apps.apple.com/kr/app/id467936485)).

**칭찬**
- "텍스트 입력만으로 항목 추가되는 기능 너무 똑똑하고"
- "다른 자동기록 앱도…동기화하느라 로딩이 느린 게…이 앱으로 돌아왔습니다"
- 출처: 둘 다 [App Store 리뷰](https://apps.apple.com/kr/app/id467936485?see-all=reviews&platform=iphone)

**불만**
- "통장으로 들어오는 돈이 현금수입으로 잡히는게 너무너무 불편" ([App Store 리뷰](https://apps.apple.com/kr/app/id467936485?see-all=reviews&platform=iphone))
- "자동 아이클라우드 백업…자꾸 안되서" ([블로그 2022](https://m.blog.naver.com/nnalsrud/222861093280))
- "일일이 노가다로 입력해야 되는 점이 불편" ([블로그 2023](https://agaea.tistory.com/entry/%EC%9C%84%ED%94%8C-%EA%B0%80%EA%B3%84%EB%B6%80-%EC%95%A0%ED%94%8C-%EC%95%84%EC%9D%B4%ED%8F%B0%EC%97%90%EC%84%9C%EB%8A%94-%EB%8C%80%EC%95%88%EC%9D%B4-%EC%97%86%EB%8A%94-%EC%95%B1-3%EB%85%84-%EC%B0%A8%EC%9D%98-%EC%82%AC%EC%9A%A9%EB%B2%95))

---

#### 7. 꼬박가계부 (추가, CASOFT)

| 항목 | 내용 | 출처 |
|---|---|---|
| 입력 | 전부 수기. 문자 인식·자동연동 없음 | [월부](https://weolbu.com/community/3355436/), [블로그](https://economyen.tistory.com/33) |
| 카테고리 / 검색 / 잠금 | 다 있음 | [App Store](https://apps.apple.com/kr/app/id6460690098) |
| 예산 / 통계 | 있음. 기간별 통계는 아직 요청 단계 | [App Store 리뷰](https://apps.apple.com/kr/app/id6460690098?see-all=reviews&platform=iphone) |
| 고정지출 | 미확인. 개발자가 "개발할 예정"이라고 답변 | [App Store 리뷰](https://apps.apple.com/kr/app/id6460690098?see-all=reviews&platform=iphone) |
| 엑셀 내보내기 / 공유 | 없음 | [블로그](https://economyen.tistory.com/33) |
| 자산·할부·환불·이체·태그·위젯 | 미확인 | |

**아이폰 + PC/Mac:** 아이폰 전용이고 M1 이상 맥에서 실행할 수 있어요. 동기화는 iCloud예요([App Store](https://apps.apple.com/kr/app/id6460690098), [공식](https://casoft.app/)). 안드로이드와 웹은 없어요.

**가격:** 무료(광고). 프리미엄 이용권 8,800원이고, 일회성인지 구독인지는 미확인이에요([App Store](https://apps.apple.com/kr/app/id6460690098)).

**칭찬:** "가계부 앱만 10개는 깔았다 지웠다 했는데 드디어 정착할것같습니다", "UI가 너무 직관적이고 깔끔해서" ([App Store 리뷰](https://apps.apple.com/kr/app/id6460690098?see-all=reviews&platform=iphone))

**불만:** "고정 지출 항목 설정…1년 넘게 사용자들이 요청하고 있지만 개선되지 않고", "최근 동영상광고가 너무 많이 떠서 프리미엄 결제" (같은 곳)

---

#### 요약

##### 아이폰 + PC/Mac 같이 쓰기
| 앱 | 아이폰 | PC/Mac | 동기화 |
|---|---|---|---|
| 편한가계부 | O | O (설치형) | 자체 서버. 실시간은 유료 구독만 |
| 후잉 | 웹 (공식 iOS 앱 미확인) | O (웹) | 서버 하나라 동기화 불필요. 유료 서비스 |
| 위플 / 꼬박 | O | M1 이상 맥에서 아이폰 앱으로 | 위플은 백업/복원, 꼬박은 iCloud |
| 뱅크샐러드 / 토스 | O | X | 계정 서버 |
| 똑똑가계부 | X | X | 구글드라이브 수동 백업 |

##### 거의 모든 앱에 있는 기본 기능
수기 입력, 카테고리 커스텀, 월 예산, 카테고리별 통계, 검색, 비밀번호/생체 잠금, 반복·고정지출. 꼬박가계부는 고정지출이 아직 없어요.

##### 일부 앱에만 있는 차별 기능
- **금융사 자동연동:** 뱅크샐러드, 토스뿐이에요. 나머지는 연동이 없어요.
- **문자/알림 자동 인식:** 편한가계부, 똑똑가계부, 위플. 셋 다 **안드로이드에서만** 돼요.
- **복식부기 재무제표, API/MCP/웹훅:** 후잉.
- **실시간 서버 동기화 + 설치형 PC 가계부:** 편한가계부 구독.
- **한 줄 자연어 입력:** 위플, 후잉 어썸박스.
- **승인취소 문자로 기록 자동 삭제:** 똑똑가계부.
- **또래 소비 비교:** 토스.
- **여러 건 상계하는 '내역 합치기':** 뱅크샐러드.
- **가족 공유:** 진짜 공유 기능은 지금 사실상 없어요. 뱅크샐러드 우리집돈관리가 종료됐고, 남은 건 편한가계부와 후잉의 계정 같이 쓰기 정도예요.

##### 사용자 불만 Top 5
1. **알림/문자 자동인식이 끊긴다:** 재부팅하라는 답만 돌아와요. 편한가계부, 똑똑가계부, 위플 리뷰에서 반복되고, 2026년 리뷰에도 계속 나와요. 아이폰은 애초에 자동인식이 불가능해요.
2. **수기 입력이 귀찮아서 그만둔다:** 편한가계부(아이폰), 후잉, 위플, 꼬박. 이탈 이유로 가장 직접적으로 언급돼요.
3. **자동연동 데이터가 틀린다:** 포인트·할인 전 승인금액, 할부, 매입취소, 이체·주식거래가 소비로 잡힘, 카테고리 오분류. 주로 뱅크샐러드와 토스예요.
4. **연동·동기화·백업 문제:** 뱅크샐러드 연동 끊김, 편한가계부 수동 동기화와 PC-모바일 잔액 불일치, 위플 iCloud 백업 실패, 똑똑가계부 서버가 없어 데이터 유실.
5. **광고·영업이 많고 가계부 본연 기능이 부족하다:** 뱅크샐러드 금융상품 광고, 꼬박 동영상 광고, 토스는 통계·예산·내보내기·공유 부족.

5위 바깥에서도 커플 공유가 안 된다는 불만과 후잉의 복식부기 학습 장벽이 자주 나왔어요.

**근거 수준 참고:**
- App Store 웹 리뷰에는 날짜가 표시되지 않아요.
- 뽐뿌, 더쿠, 디시는 검색에 거의 잡히지 않았어요. 커뮤니티 근거는 주로 클리앙이에요.
- 2025~26년 블로그 상당수는 SEO/AI 생성 글로 보여서 최대한 뺐어요. 폐업한 브로콜리를 아직 추천하는 글이 많은 게 그 근거예요.
- 토스의 이체 자동 제외는 2021년 자료라, 지금도 그대로인지는 확인하지 못했어요.

---

## 부록 C. 해외 Mac·iPhone 앱 조사 (Aside 세션 DCPeJtnjVlg3kdRW)

8개 앱에 자주 추천되는 2개(Moneydance, Quicken Classic for Mac)를 더해 10개를 조사했어요. 공개 페이지만 읽었고 로그인, 결제, 글 작성은 하지 않았습니다.

**먼저 알아둘 점**
- Reddit 인용은 상당수가 검색 결과 발췌입니다. 본문 전체는 열어보지 못했습니다.
- App Store 리뷰는 날짜가 안 보이는 것이 많아서 "날짜 미확인"으로 적었습니다.
- 기준일은 2026-11-04입니다.

#### 한눈에 보기

| 앱 | Mac에서의 형태 | 동기화 구조 | 가격 |
|---|---|---|---|
| MoneyWiz | Mac App Store 앱 (프레임워크 미확인) | 자체 서버(SYNCbits), 오프라인 입력 가능 | 구독 (표기 금액이 서로 다름) |
| Copilot Money | 네이티브 Mac 앱 + 웹 | 자체 서버 + 은행 연동 업체 여러 곳 | 연 $109 |
| Money Pro | 구형 Mac 전용 앱 | iCloud(무료) 또는 자체 Sync(유료) | 앱별 구매 + 구독 |
| Banktivity | 네이티브 Mac 앱 | 자체 Cloud Sync, Mac의 로컬 파일 | Bronze/Silver/Gold, 금액 미확인 |
| YNAB | Mac 앱 없음 (웹) | 서버 기반, 모바일 오프라인 가능 | 월 $14.99 / 연 $109 |
| Monarch | Mac 앱 없음 (웹) | 서버 기반 + 은행 연동 업체 3곳 | 월 $14.99 / 연 $99.99 |
| Actual Budget | 웹/PWA + 데스크톱 앱 | 로컬 우선, 선택형 종단간 암호화 | 무료, 호스팅비 약 $1.5~1.8/월 |
| Lunch Money | 웹 우선 (Mac 앱 미확인) | 서버 기반 + Plaid | 월 $10 / 연 $100 |
| Moneydance (추가) | 데스크톱 앱 (Java 기반 흔적) | 자체 암호화 동기화, 전송은 Dropbox 또는 iCloud Drive | 일회성 $65 |
| Quicken Classic Mac (추가) | 네이티브 Mac 앱 | Quicken Cloud, 데스크톱 파일이 기준 | 연간 결제 시 월 $7.99부터 (Premier) |

---

#### 1. MoneyWiz (SilverWiz)

1. **Mac 형태:** Mac App Store에 iPhone, iPad, Mac, Vision, Watch용으로 올라 있고 macOS 14 이상이 필요합니다. 네이티브인지 Catalyst인지는 미확인입니다. 최신 버전에는 Mac 전용으로 MCP 연동이 있어서 Claude나 ChatGPT가 열린 DB를 읽을 수 있습니다. https://apps.apple.com/us/app/moneywiz-personal-finance/id1511185140?mt=12
2. **동기화:**
   - 자체 서버 "MoneyWiz Cloud by SYNCbits"를 씁니다. 서버에는 현재본 하나만 있고 이전 시점으로 되돌릴 수 없습니다. 실수하면 모든 기기에서 앱을 끄고 Mac의 자동 백업을 확인하라고 안내합니다. https://help.wiz.money/en/articles/4440665-how-to-revert-undo-a-change-made-to-my-data
   - 오프라인에서 입력한 뒤 온라인이 되면 동기화됩니다. https://justuseapp.com/en/app/1004710719/moneywiz-3-personal-finance/reviews
   - 은행 연동은 업체 4곳이고, 리뷰에는 Plaid, Salt Edge, Yodlee가 나옵니다. 정확한 목록은 미확인입니다.
3. **기능:**
   - OFX, QIF, CSV, MT940 가져오기, 일괄 편집, 명세서 대조, 이체·환불 자동 감지, 30개 이상의 리포트가 있습니다. (App Store URL 위와 같음)
   - Mac에서만 특히 잘 되는 작업은 미확인입니다.
4. **불만:**
   - 2022-05-31: "Lost data… I lost huge amount of data and was unable to recover it." https://apps.apple.com/gb/app/moneywiz-2026-personal-finance/id1511185140?platform=iphone&see-all=reviews
   - iCloud 방식으로 바꿨다가 원래 동기화로 돌아간 사용자: "Despite backing up my data from the iCloud version the import failed… spend several hours rekeying" (같은 URL)
   - 2026.28.1 업데이트 후: "my database disappeared". 개발사는 일부 사용자가 DB에서 로그아웃되는 버그였고 2026.28.2에서 고쳤다고 답했습니다. https://apps.apple.com/jp/app/moneywiz-2026-personal-finance/id1511185140?platform=iphone&see-all=reviews
   - Plaid로 은행을 연결한 뒤: "all of my existing bank accounts with chase have now been duplicated… screwed up all of the balances" https://apps.apple.com/us/app/moneywiz-2026-personal-finance/id1511185140?l=ko&platform=mac&see-all=reviews
5. **가격:**
   - 같은 App Store 페이지 안에서 두 금액이 다르게 적혀 있습니다. 본문은 Premium 월 $4.99 / 연 $49.99, Standard 연 $19.99입니다. 인앱결제 목록은 Premium 월 $5.99 / 연 $59.99, Standard 연 $29.99입니다. (Mac App Store URL)
   - Standard는 동기화만 되고, 은행 연동은 Premium부터입니다.

#### 2. Copilot Money

1. **Mac 형태:**
   - 공식 도움말에 "Copilot for macOS is a native app"이라고 되어 있습니다. https://help.copilot.money/en/articles/6778561-copilot-money-for-macos
   - AppKit이라는 설명은 서드파티 리뷰에만 있습니다. https://scored.tools/blog/copilot-money-review-2026
   - 웹 앱은 2025년 12월에 나왔고, 미국 전용입니다. https://help.copilot.money/en/articles/11780342-copilot-money-for-web
2. **동기화:**
   - 서버 기반이고 은행 연동 업체를 여러 곳 씁니다 ("multiple data aggregators"). https://help.copilot.money/en/articles/5593601-adding-and-managing-connected-accounts
   - 주력은 Plaid이고 MX, Akoya 등도 쓴다는 정리는 제3자 출처입니다. https://wealthypot.com/budgeting-apps/copilot-money/
   - CloudKit 사용 여부, 로컬 우선 여부, 오프라인 입력 가능 여부는 모두 미확인입니다.
3. **기능:**
   - Mac 앱에는 ⌘F 검색과, 거래를 열지 않고 카테고리를 바꾸는 기능이 있습니다. (macOS 도움말 URL)
   - 웹에는 단축키 X/R/C/⌘A와 일괄 "검토 완료" 처리가 있습니다. 대신 웹에는 Goals, Cash Flow, 규칙 만들기가 없습니다. https://help.copilot.money/en/articles/13157382-web-faq
4. **불만:**
   - 데이터 유실: "I had January-June 2024 transactions go missing". 지원팀은 Plaid에서 삭제 처리된 거래였다고 답했다고 합니다. https://www.reddit.com/r/copilotmoney/comments/1f1sv9s/missing_transaction_data
   - 중복: "Plaid connections that used to sync cleanly now duplicate transactions" https://www.reddit.com/r/copilotmoney/comments/1okkh09/longtime_user_considering_starting_over/
   - "random duplicate transactions that show up months later… automatically recategorized months after I had already manually categorized them" https://www.reddit.com/r/copilotmoney/comments/1olq1uy/best_alternative_copilot
   - 연동 업체를 Plaid에서 MX로 바꿀 때: "ALL HISTORY that I input via Plaid would be erased (notes, coding....)" https://www.reddit.com/r/copilotmoney/
5. **가격:** 플랜은 하나입니다. 연 $109(월 $9 환산)이고 iPhone, iPad, Mac, 웹이 모두 포함됩니다 ([출처](https://www.copilot.money/pricing)). 제3자 사이트들의 "연 $95"는 예전 가격으로 보입니다.

#### 3. Money Pro (Ibearsoft)

1. **Mac 형태:**
   - Mac 전용 앱이 따로 있습니다 ("Only for Mac"). https://apps.apple.com/us/app/money-pro-personal-finance/id972572731?mt=12
   - 새 3.0 앱은 iPhone 전용입니다. 개발사는 "In the future… available for Mac and iPad"라고 했습니다. https://apps.apple.com/fi/app/money-pro/id1549683587
   - 네이티브인지 Catalyst인지는 미확인입니다.
2. **동기화:**
   - 같은 iCloud를 쓰는 Apple 기기끼리는 무료로 동기화됩니다. https://moneyproapp.com/faq/faq.html
   - Android, Windows와 섞어 쓰거나 가족과 공유하려면 유료 "Money Pro Sync"가 필요합니다. https://money.pro/mac
   - 기본 저장은 기기 로컬이고, 백업도 로컬에만 저장됩니다. https://money.pro/faq/
   - 3.0에서는 iCloud를 빼고 구독형 동기화로 바꿨습니다. 개발사 답변: "supporting iCloud sync became difficult" https://apps.apple.com/ua/app/money-pro/id1549683587
3. **기능:** 캘린더 기반 청구서 계획, 예산, 다중통화, PDF/QIF/CSV 내보내기가 있습니다. https://apps.apple.com/tw/app/money-pro-personal-finance/id972572731?mt=12 Mac 특화 작업은 미확인입니다.
4. **불만:**
   - 2023-11-13: "iCloud sync is horrible. Every time I add multiple items on my Mac then at least 1 is messed up on my iPhone. There are cases when 10-20 transaction don't sync at all." https://apps.apple.com/pl/app/money-pro-personal-finance/id972572731?mt=12
   - "the icloud sync seems to stop working between my laptop and phone after a bank sync. The fix… was deleting the app on my phone and reinstalling it." https://apps.apple.com/us/app/money-pro-personal-finance/id972572731?mt=12
   - 3.0 관련: "forcing to pay $35 year just to sync data, what you can do for free" (2025-11-17, ua URL 위와 같음)
5. **가격:**
   - 구형 Mac 앱은 PLUS 월 $4.99, GOLD 월 $9.99 인앱결제가 있습니다 (tw URL). 앱 자체 가격은 미확인입니다.
   - 3.0은 연 구독으로, 리뷰 기준 연 $35입니다.
   - 앱은 플랫폼별로 따로 팝니다. https://money.pro/faq/

#### 4. Banktivity (IGG Software)

1. **Mac 형태:** "Banktivity is not a web app – it runs natively on your Mac, iPhone and iPad" ([출처](https://www.banktivity.com/content/plans/plans.php))라고 밝힌 네이티브 앱입니다.
2. **동기화:**
   - CloudKit이 아닌 자체 Banktivity Cloud Sync 서버를 쓰고, 활성 구독이 필요합니다. 장부는 Mac의 로컬 문서입니다. https://www.banktivity.com/content/help/v10/cloud_sync.php
   - 메이저 버전이 다르면(예: v8과 v9) 동기화가 안 되고 "may corrupt your financial data"라고 경고합니다. 첨부파일과 시세 이력은 동기화되지 않습니다. (같은 URL)
   - 동기화를 복구할 때는 데이터가 가장 온전한 Mac에서 시작하라고 안내합니다. https://www.banktivity.com/support/articles/ibank-for-ipad/how-to-fix-an-invalid-document-id-error/
   - 은행 연동이 Yodlee/Plaid라는 정보는 포럼 출처라 공식 확인은 아닙니다. https://forums.macrumors.com/threads/banktivity-offers-30-off-first-year-subscriptions-for-macrumors-readers.2492948
3. **기능:**
   - 가져올 때 중복을 자동으로 매칭하고 계좌 간 이체를 연결합니다. https://www.banktivity.com/content/help/v9/importing/resolve.php
   - 중복 거래는 드래그해서 합칠 수 있습니다. https://www.banktivity.com/support/articles/banktivity-for-mac/after-a-download-i-edited-a-transaction-where-can-i-see-the-original-data/
   - 다중통화는 Gold 플랜에서만 됩니다 (plans URL).
   - 일괄 편집과 키보드 입력은 미확인입니다.
4. **불만:**
   - "Cloud Sync frequently fails to work correctly (with no error or warning messages), leaving the balances and registers incorrect." https://justuseapp.com/en/app/1277991350/banktivity-personal-finance/reviews
   - "When I sync, there are transactions that get either deleted or adjusted on both my phone and Mac." (같은 URL)
   - 2023-05, 휴대폰이 예전 파일을 열어둔 상태로 동기화한 사례: "hundreds (maybe thousands?) of repaired transactions have been deleted from my repaired mac file due to cloud sync from mobile" https://spylopi.weebly.com/blog/banktivity-8
   - 파일을 Dropbox나 OneDrive에 넣었다가: "it corrupted the file". 지원팀이 약 98%를 복원했습니다. https://www.trustpilot.com/review/banktivity.com
5. **가격:** Bronze/Silver/Gold 연간 결제에 30일 무료 체험이 있습니다. 구독 하나로 모든 기기를 쓰고, 구독이 끝나도 데이터 내보내기는 계속 됩니다 ([출처](https://www.banktivity.com/content/plans/plans.php)). 금액은 페이지 텍스트에 없어서 미확인입니다.

#### 5. YNAB

1. **Mac 형태:**
   - Mac 앱은 없습니다. 공식 라인업은 웹, iPhone, iPad, Android, Watch입니다. https://www.ynab.com/our-app-lineup
   - App Store에도 Mac 표시가 없습니다. iPad 앱을 Apple Silicon Mac에서 쓸 수 있는지는 미확인입니다. https://apps.apple.com/us/app/ynab/id1010865877
2. **동기화:**
   - 서버 기반이고 오프라인 사용을 광고합니다 ("even offline!"). https://www.ynab.com/features
   - 다만 오프라인이 너무 길면 기기의 로컬 데이터를 버리고 서버에서 다시 받습니다 ("Plan Out of Date"). https://support.ynab.com/en_us/troubleshooting-bugs-or-issues-in-ynab-an-overview-ByiMG2fAc
   - Apple Card는 iPhone에서만 연결할 수 있고, 최근 31일치만 가져옵니다. https://support.ynab.com/apple-third-party-H1gE_0CRyg
3. **기능:**
   - 봉투식 예산입니다.
   - 파일 가져오기는 웹과 iPad에서만 됩니다. https://support.ynab.com/en_us/file-based-import-a-guide-Bkj4Sszyo
   - 대사(잔액 맞추기) 중 중복 확인은 "easiest on a computer"라고 공식 안내합니다. https://support.ynab.com/en_us/troubleshooting-reconciliation-issues-rJkijlVki
4. **불만:**
   - "all of the transactions I just entered were gone." 약 30분에 걸쳐 다시 나타났다고 합니다. https://www.reddit.com/r/ynab/comments/18723zo/ynab_sync_issues_are_becoming_a_problem
   - "you'll have to reauthorize them every week or so." https://www.reddit.com/r/ynab/comments/1ph0su8/do_other_budget_apps_have_as_many_sync_issues_as
   - "it hasn't synced for the second and third weeks of July August and September… I had to enter all those missing entries manually." https://www.reddit.com/r/ynab/comments/1pthhxz/stopped_syncing
5. **가격:** 월 $14.99 또는 연 $109이고 30일 무료 체험이 있습니다. https://www.ynab.com/features

#### 6. Monarch Money

1. **Mac 형태:**
   - 네이티브 Mac 앱이 없고 웹으로 씁니다. 공식 요금 페이지는 "web, mobile, or iPad"라고만 적습니다. https://www.monarch.com/pricing
   - Mac 앱이 없다는 명시적 근거는 제3자 글입니다. https://thetoolstrunk.com/does-monarch-have-a-desktop-app
   - iPad 앱을 Mac에서 쓸 수 있는지는 미확인입니다.
2. **동기화:**
   - 클라우드 기반이고, 은행 연동 업체 Plaid, Mastercard(구 Finicity), MX 중에서 기관별로 사용자가 바꿀 수 있습니다. https://help.monarchmoney.com/hc/en-us/articles/360048393352-Guide-to-Connecting-Your-Accounts
   - 오프라인 입력은 미확인입니다.
3. **기능:**
   - 여러 거래를 한꺼번에 수정할 수 있습니다. https://help.monarch.com/hc/en-us/articles/360048393532
   - 규칙을 기존 거래에 소급 적용할 수 있습니다. https://help.monarch.com/hc/en-us/articles/360048393372-Transaction-Rules
   - CSV 가져오기는 웹에서만 되고, 내보낸 뒤 스프레드시트에서 고쳐 다시 가져오면 기존 거래가 갱신됩니다. https://help.monarch.com/hc/en-us/articles/4409682789908-Importing-Transactions-Manually
   - 잔액 이력 편집도 웹에서만 됩니다. https://help.monarch.com/hc/en-us/articles/32368722344212-Manually-Edit-an-Account-Balance
4. **불만:**
   - 은행 재연결 시 계좌가 새로 생기는 문제: "it opens up a new account, so now I have duplicate transactions. This happens a few times a year." https://www.reddit.com/r/MonarchMoney/comments/1wp1y1e/these_broken_connections_are_killing_me/
   - "missing transactions… worse situation since you can't see it's missing, whereas duplicates are easy to find" https://www.reddit.com/r/MonarchMoney/comments/1b5mkwj/sync_issues_and_duplicate_transactions_undermine/
   - 검토까지 끝낸 8개월치 거래가 AI 때문에 다시 분류된 사례 https://www.reddit.com/r/MonarchMoney/comments/1ur7p6r/why_does_everyone_in_here_complain_so_much
5. **가격:** Core 월 $14.99 또는 연 $99.99이고 7일 무료 체험이 있습니다. https://www.monarch.com/pricing Plus는 연 $199.99입니다 (제3자 출처). https://fyn.fyi/blog/quicken-vs-monarch-money/

#### 7. Actual Budget (오픈소스)

1. **Mac 형태:**
   - 기본은 서버를 두고 웹/PWA로 쓰는 방식입니다. https://actualbudget.org/docs/install
   - 데스크톱 앱도 있습니다. 문서에는 "desktop app"이라고만 나와서 Electron인지는 미확인입니다. 서버가 있으면 버전 차이 때문에 데스크톱 앱보다 웹을 권장합니다. https://actualbudget.org/docs/install/desktop-app
   - 공식 모바일 앱은 지원 종료(deprecated)이고, iPhone에서는 PWA를 씁니다. https://actualbudget.org/docs/faq/
2. **동기화:** 로컬 우선 구조입니다. 근거는 모두 https://actualbudget.org/docs/getting-started/sync 입니다.
   - 네트워크 없이 동작하고, 연결되면 백그라운드로 동기화합니다.
   - 종단간 암호화는 선택 사항이고, 한 번 켜면 끌 수 없습니다.
   - "Reset sync"를 하면 선택한 기기가 기준이 되고, 다른 기기의 아직 동기화되지 않은 변경은 되돌려집니다.
   - 같은 파일을 동시에 편집하는 것은 피하라고 안내합니다.
   - 변경 내역이 계속 쌓여서 파일이 커집니다. https://actualbudget.org/docs/faq/
3. **기능:**
   - 봉투식 예산이고, 이체하면 양쪽 거래가 연결되며, undo/redo가 됩니다. https://actualbudget.org/
   - QIF, OFX, QFX, CAMT.053, CSV를 가져올 수 있습니다. 은행 연동은 SimpleFIN, GoCardless, Pluggy입니다. https://actualbudget.org/docs/transactions/importing/
   - 데스크톱 전용 작업은 미확인입니다.
4. **불만 (GitHub 이슈):**
   - 2025-12: "it reverted the file back to how it was before today (i.e. reverted all changes done today)" https://github.com/actualbudget/actual/issues/6323
   - 2022-04: Reset sync 후 "my budget was lost and a previously deleted budget has taken its place." https://github.com/actualbudget/actual/issues/5
   - 2026-04: "We had problems syncing your changes" 오류가 한 달 넘게 계속됐고, 입력한 기기에서만 데이터가 보였습니다. 이슈는 not planned로 닫혔습니다. https://github.com/actualbudget/actual/issues/7542
   - 은행 연동 중복: "If I delete a duplicate, it comes back on the next sync." https://github.com/actualbudget/actual/issues/2519
5. **가격:** 무료(MIT 라이선스)입니다. PikaPods 호스팅은 공식 문서상 약 $1.50/월입니다. https://actualbudget.org/docs/install/pikapods 제3자 사이트는 신규 가격을 $1.80/월로 적습니다. https://budgetingapps.org/apps/actual-budget fly.io 비용은 미확인입니다.

#### 8. Lunch Money

1. **Mac 형태:** 웹 우선 서비스이고 iOS와 Android 보조 앱이 있습니다. https://lunchmoney.app/download Mac 네이티브 앱은 미확인입니다.
2. **동기화:**
   - 서버 기반이고 은행 데이터는 Plaid를 거칩니다. 은행에서 Plaid까지 1~3 영업일, Lunch Money는 최소 2일마다 Plaid와 동기화합니다. https://support.lunchmoney.app/setup/accounts/faq
   - 오프라인은 미확인입니다.
3. **기능:**
   - 다중통화, 암호화폐 추적, API가 모든 플랜에 포함됩니다. https://lunchmoney.app/pricing
   - 규칙과 중복 제거 도구가 있습니다. https://support.lunchmoney.app/finances/transactions/transactions
   - 데스크톱 전용 작업은 미확인입니다.
4. **불만:**
   - 수동 입력한 거래를 Plaid가 1~2일 뒤에 또 가져오는 문제: "1-2 days later the transaction will auto-sync via Plaid and create duplicate entries." https://www.reddit.com/r/lunchmoney/comments/1us32w8/struggling_with_duplicate_entries_after_manually
   - 중복 제거 기능이 "doesnt always match accurately" https://feedback.lunchmoney.app/transactions
   - 은행을 다시 연결하면 마지막 거래일부터 다시 가져와서 중복이 생길 수 있습니다. https://feedback.lunchmoney.app/accounts-assets
5. **가격:** 월 $10 또는 연 $100이고 30일 무료 체험이 있습니다. https://lunchmoney.app/pricing

#### 9. Moneydance (추가: 구독 없는 데스크톱 앱으로 자주 추천)

추천 근거: https://talk.tidbits.com/t/quicken-alternatives-for-basic-financial-accounting/22478 , https://machow2.com/best-personal-finance-software-mac

1. **Mac 형태:** 데스크톱 앱이고 "a little quirky, possibly because of its Java roots"라는 평이 있습니다 (TidBITS URL). iOS 앱은 "companion app. It cannot do all that the full version… can do"입니다. https://talk.tidbits.com/t/help-deciding-an-app-for-personal-finance-in-2023/22347
2. **동기화:** 자체 암호화 동기화를 쓰고, 전송 경로는 Dropbox나 iCloud Drive 중에서 고릅니다. 데이터 파일은 로컬에 두라고 권장하며, 공유 폴더에 두면 손상될 수 있다고 안내합니다. https://infinitekind.tenderapp.com/kb/syncing-and-sharing-data/syncing-with-the-mobile-app 휴대폰 오프라인 입력은 미확인입니다.
3. **기능:** 은행 연동은 별도 구독(Moneydance Plus)입니다. Mac 특화 작업은 미확인입니다.
4. **불만:**
   - 2026-06: "Each Mac is keeping it's own version… my iPhone's MoneyDance app is not syncing" http://infinitekind.tenderapp.com/discussions/problems/118189-sync-via-dropbox-seems-broken
   - 2022-04: "the secondary computer (intel mac) always had different data, missing large sums of money" https://infinitekind.tenderapp.com/discussions/iphone-ipod-touch-ipad-android-app-questions/15476-my-experience-with-dropbox-syncing-and-monterey-1231
5. **가격:** 일회성 $65입니다. Plus는 월 $4 또는 연 $40입니다. https://infinitekind.com/purchase

#### 10. Quicken Classic for Mac (추가)

추천 근거: https://robberger.com/best-budgeting-apps-for-mac-users

1. **Mac 형태:** 네이티브 Mac 앱입니다. 사용자 평: "The Mac version is rock solid since it was built from the ground up". https://www.reddit.com/r/quicken/comments/1rp581c/does_anyone_else_hate_what_quicken_has_become/
2. **동기화:** Quicken Cloud를 거치고 데스크톱 파일이 기준입니다. 모바일 앱은 "companion app and requires the desktop Quicken program"입니다. https://www.quicken.com/support/troubleshooting-quicken-mobile-companion-app 오프라인은 미확인입니다.
3. **기능:** Mac 특화 작업은 미확인입니다. 모바일 앱은 "clunky and slow at best but serviceable"라는 평이 있습니다. https://www.reddit.com/r/simplifimoney/comments/1mq5scp/any_former_quicken_classic_users_make_the/
4. **불만:**
   - 공식 문서가 "a completed sync that appears successful but… the data is missing" 증상을 안내합니다. https://www.quicken.com/support/troubleshooting-cloud-sync-errors
   - 2026-09: "I tried to reset my cloud account, but it did not resolve the issue." https://community.quicken.com/discussion/7976672/transaction-sync-error
   - Mac 사용자의 데이터 유실 사례는 미확인입니다.
5. **가격:** 연간 결제 기준 Premier 월 $7.99입니다. https://www.quicken.com/products/pricing-comparison Deluxe 금액은 미확인입니다.

---

#### 요약

##### Mac과 iPhone 역할 나누기
- **iPhone은 입력과 확인, 큰 화면은 정리라는 흐름이 공식 문서에 반복해서 나옵니다.**
  - YNAB은 파일 가져오기를 웹과 iPad로만 열어두고, 중복 확인은 "easiest on a computer"라고 안내합니다.
  - Monarch는 CSV 가져오기와 잔액 이력 편집을 웹 전용으로 둡니다.
  - Copilot은 Mac에 ⌘F 검색과 바로 카테고리 바꾸기를, 웹에 일괄 검토 단축키를 넣었습니다.
  - 출처는 위 각 앱 항목에 있습니다.
- **평이 가장 좋은 쪽은 iPhone과 Mac 모두 네이티브로 같은 수준인 Copilot입니다.**
  - "built first for the iPhone and Mac" https://independent-app-reviews.org/reviews/copilot-money-review
  - "Mac 앱이 데스크톱 경험 중 최고"라는 평을 받는 YNAB은 실제로는 Mac 앱이 없어서, 이 비교 글은 신뢰도가 낮습니다. https://walletgrower.com/compare/ynab-vs-monarch-vs-copilot
- **역할을 명시적으로 나눈 오래된 사례:** "Next for iPhone launches in expense creation mode; Next for iPad and Mac prioritize viewing over adding." https://www.macstories.net/reviews/how-i-track-my-expenses-next-for-iphone-and-ipad/
- **Mac이 기준이고 iPhone이 보조인 앱은 "폰 입력이 데스크톱에 안 넘어온다"는 불만이 핵심입니다.** Banktivity, Moneydance, Quicken이 여기에 해당합니다.
- **한계:** "iPhone에서 입력하고 Mac에서 대사한다"를 그대로 쓴 사용자 후기는 찾지 못했습니다 (미확인). 위 패턴은 공식 문서와 리뷰에서 추론한 것입니다.

##### 동기화 방식별로 실사용에서 드러난 장단점

| 방식 | 앱 | 실사용에서 드러난 장점 | 실사용에서 드러난 문제 |
|---|---|---|---|
| 서버 + 은행 연동 업체 | Copilot, Monarch, YNAB, Lunch Money | 여러 기기 실시간 반영, 기기 분실에도 안전 | 불만의 대부분이 동기화 엔진이 아니라 은행 연결 쪽: 끊김, 재인증, 중복, 누락, 수개월 뒤 재분류. 연동 업체를 바꾸면 메모·분류 이력이 사라진 사례(Copilot). YNAB은 오래 오프라인이면 로컬 데이터를 버림 |
| iCloud | Money Pro(구형), Moneydance 선택지 | 무료, 계정 설정 불필요 | 일부 거래만 조용히 안 넘어감("10-20 transaction don't sync"), 재설치로 해결. 개발사가 "iCloud sync became difficult"라며 포기(Money Pro 3.0) |
| 로컬 문서 + 자체 동기화 서버 | Banktivity, MoneyWiz, Quicken | Mac에 원본 파일이 있어 대량 작업에 강함 | 오류 표시 없이 실패("no error or warning"). 예전 파일을 연 기기가 고친 데이터를 덮어씀. 시점 복원 불가(MoneyWiz). 버전이 다르면 파일 손상 경고(Banktivity) |
| 파일을 Dropbox 같은 공유 폴더로 동기화 | Moneydance, Banktivity 사용자 사례 | 업체 서버 불필요 | 기기마다 다른 버전이 생김, 파일 손상. 두 공식 문서 모두 원본을 공유 폴더에 두지 말라고 함 |
| 로컬 우선(Actual) | Actual Budget | 오프라인 완전 동작, 종단간 암호화 가능 | "Reset sync"가 다른 기기의 변경을 되돌림, 하루치 변경이 되돌아간 사례, 한 달 지속된 동기화 오류, 파일이 계속 커짐, 동시 편집 비권장 |

요약하면, 어떤 방식이든 사용자를 가장 화나게 하는 것은 **아무 표시 없이 일어나는 불일치**입니다. 이런 문장이 그대로 나옵니다.
- Monarch: "missing… worse… since you can't see it's missing"
- Banktivity: "no error or warning"
- Quicken: "appears successful but… data is missing"

반대로 Actual의 "되돌리기 전에 먼저 내보내라"나 MoneyWiz의 Mac 자동 백업처럼 사용자가 직접 복구할 수단이 있는지가 평가를 크게 가릅니다.

##### 가계부 도메인에서 놓치기 쉬운 데이터 처리 문제
- **이체:**
  - 두 은행에서 각각 가져오면 한쪽은 지출, 한쪽은 수입으로 잡혀 수입·지출 합계가 부풀려집니다. 계좌 잔액 자체는 맞습니다. https://github.com/firefly-iii/firefly-iii/issues/1845
  - 묶인 이체 중 한쪽을 지우면 양쪽이 같이 지워지고, 다음 동기화 때 다시 들어옵니다. https://github.com/actualbudget/actual/issues/3485 , https://github.com/firefly-iii/firefly-iii/issues/6604
  - 카드 대금 첫 결제는 이체가 아니라 출금과 입금 두 건으로 보일 수 있습니다. https://support.ynab.com/en_us/how-to-handle-imported-credit-card-payments-SkXcoodci
- **환불:**
  - "원래 지출에서 빼기"와 "수입으로 잡기" 중 하나로 정책을 정해야 합니다. 부분 환불을 입금으로 넣으면 원래 거래의 예산은 그대로입니다. https://docs.firefly-iii.org/tutorials/finances/refund
  - 환불로 카드 잔액이 양수가 되면 카테고리 계산이 어긋납니다. https://support.ynab.com/en_us/credit-cards-with-a-positive-balance-an-overview-By_H6uzJo
  - Copilot은 아예 "unmatched refunds"를 자동 매칭 대상으로 내세웁니다. https://www.copilot.money/pricing
- **분할 거래:**
  - 분할한 이체가 반대 계좌에서는 연결되지 않은 거래 2건으로 생깁니다. https://github.com/actualbudget/actual/issues/5694
  - 규칙으로 분할한 예정 거래가 잔액에서 두 번 빠집니다. https://github.com/actualbudget/actual/issues/3508
  - 필터를 건 상태에서 분할한 거래가 사라지고, 분할 후 규칙이 실행되지 않는 버그가 있었습니다 (2026-09 수정). https://feedback.lunchmoney.app/changelog
  - 엔화처럼 소수점이 없는 통화에서 분할 금액 입력이 0으로 돌아갑니다. https://github.com/actualbudget/actual/issues/6601
- **할부:**
  - 미리 만들어 둔 할부 거래가 현재 잔액에 섞여 은행 잔액과 맞지 않습니다. https://github.com/actualbudget/actual/issues/2354
  - 같은 논의에서 "무이자 할부는 다른 나라에선 흔치 않다"는 반응이 있어, 북미 중심 앱이 할부를 깊이 다루지 않을 가능성이 보입니다. https://github.com/actualbudget/actual/issues/1142
  - 한국 카드 할부를 제대로 지원하는 사례는 이번 조사에서 미확인입니다.
- **통화:**
  - 환율을 직접 지정할 수 없어서 "the totals won't add up correctly"라는 불만이 있습니다. https://feedback.lunchmoney.app/general-feature-request/p/override-currency-exchange-rate-used
  - 통화가 다른 계좌 간 이체는 각 계좌 통화로 따로 입력해야 합니다. https://support.lunchmoney.app/finances/transactions/transactions
  - Monarch는 USD/CAD 계좌만 연결하라고 권장합니다. https://help.monarchmoney.com/hc/en-us/articles/19985735202068-Monarch-FAQs
  - 거래 시점 환율과 해외 결제 수수료 처리는 미확인입니다.
- **잔액 불일치와 중복:**
  - 은행이 나중에 날짜, 가맹점명, 금액을 바꾸면 같은 거래가 중복으로 들어옵니다. https://support.ynab.com/en_us/my-transactions-are-importing-more-than-once-ByyZUaPge
  - 승인 대기(pending) 금액과 확정 금액이 다르면 매칭이 안 돼 중복이 생깁니다. https://support.ynab.com/en_us/pending-transactions-an-overview-Bk0WoOcA5
  - 대사를 기준점으로 삼아, 마지막 대사보다 3일 넘게 이전인 거래는 가져오지 않게 막습니다. https://support.ynab.com/en_us/reconciling-accounts-a-guide-BJFE3fHys
  - 수동 입력 후 은행 연동으로 같은 거래가 또 들어옵니다 (Lunch Money 위 URL).
  - Lunch Money에는 대사 기능 자체가 없습니다. https://feedback.lunchmoney.app/transactions/p/reconcile-transactions
- **날짜와 시간대:**
  - 서버와 브라우저의 시간대가 다르면 "November 0" 같은 날짜가 표시됩니다. https://github.com/firefly-iii/firefly-iii/issues/9839
  - 업데이트 후 예전 거래가 UTC로 해석되어 5시간 어긋났습니다. https://github.com/orgs/firefly-iii/discussions/9793
  - Plaid가 날짜를 바꾸면 "Use authorized date" 설정이 무시됩니다. https://feedback.lunchmoney.app/bugs
- **사용자가 고친 값이 다시 덮어써지는 문제:** 수동으로 정한 카테고리를 자동 분류가 몇 달 뒤 다시 바꿉니다. 근거는 Copilot과 Monarch의 Reddit 글(위 URL)입니다.
- **미확인:** 두 기기에서 같은 거래를 동시에 고칠 때의 충돌 처리, 부동소수점 금액 오차, 카테고리 이력 변경은 근거를 찾지 못했습니다.

더 파고들 만한 다음 단계는 두 가지입니다. 하나는 Banktivity 가격과 YNAB iPad 앱의 Mac 실행 여부처럼 미확인으로 남은 항목을 브라우저로 직접 확인하는 것이고, 다른 하나는 한국 가계부 앱(뱅크샐러드, 편한가계부 등)이 할부와 이체를 어떻게 처리하는지 추가로 보는 것입니다.

---

## 부록 D. 기술 제약 조사 (Aside 세션 LsJXSyQ9H298Ho1a)

10개 항목 모두 확인했어요. 공식 출처가 있는 건 공식 출처로 인용했고, 2차 출처밖에 없는 건 따로 적었어요. 로그인이나 가입은 하지 않았어요.

#### A. 한국에서 거래 내역 자동 입력

**1. 마이데이터 / 오픈뱅킹 (개인 개발자는 사실상 불가)**
- **마이데이터:** 금융 분야 마이데이터 사업을 하려는 모든 회사는 금융위원회 허가를 받아야 해요. ([출처](https://www.fsc.go.kr/po010105/74324?curPage=8&srchBeginDt&srchCtgry=5&srchEndDt&srchKey&srchText)) 허가 요건은 최소 자본금 5억원, 시스템·보안체계 적정성, 사업계획 타당성, 대주주 적격성, 임원자격, 전문성 ([출처](https://www.mydatacenter.or.kr:3441/myd/mydsvc/sub4.do))이고, 예비허가와 본허가 두 단계로 진행돼요. ([출처](https://www.mydatacenter.or.kr:3441/myd/mydsvc/sub4.do))
- **허가가 필요 없는 경우:** 같은 금융위 자료에 "개인신용정보를 저장·접근하지 못하는 단순 가계부 어플 개발"은 허가 불필요 ([출처](https://www.fsc.go.kr/po010105/74324?curPage=8&srchBeginDt&srchCtgry=5&srchEndDt&srchKey&srchText))로 명시돼 있어요. 직접 입력하는 가계부는 문제없다는 뜻이에요.
- **본인에게 직접 전송:** 법에는 신용정보주체가 본인 개인신용정보를 "해당 신용정보주체 본인"에게 전송해 달라고 요구할 수 있다 ([출처](https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1013342221))고 돼 있어요. 다만 개인이 이 권리를 API로 쓸 수 있는 공개 창구는 찾지 못했어요: **미확인**.
- **오픈뱅킹:** 이용기관은 금융결제원과 이용계약을 맺고 승인받은 핀테크사업자 및 참가기관 ([출처](https://openapi.kftc.or.kr/service/openBanking))이고, 대상은 핀테크산업 분류업종 기업, 전자금융업자, 전자금융보조업자 등 ([출처](https://openapi.kftc.or.kr/service/openBanking))이에요. 약관상 서류 심사(사업모델, 법적 자격, 재무상태, 보안수준), 보안점검, 현장 실사를 거쳐 이용승인 ([출처](https://openapi.kftc.or.kr/common/notiFileDownload?atch_file_id=OTU3ZjkWXY37OmbGmmZRiors64nbUjcOUxYO%2FN6lxnNvB2nQWo&atch_seq_no=N2QxNWM4ay5%2FyN6ju%2Bvs%2FkjMhHF5Q))이 나요.
- **개발자 사이트:** 누구나 가입해서 테스트해 볼 수 있지만, 사업화는 이후 이용신청을 거쳐야 해요. ([출처](https://developers.kftc.or.kr/dev/user/register)) 테스트 환경에서 본인 실계좌 데이터가 조회되는지는 **미확인**이에요.

**2. FinanceKit (한국 미지원)**
- 지원 국가는 미국과 영국 두 곳뿐이에요.
  - 미국: iOS 17.4 이상, Apple Card, Apple Cash, Savings만 ([출처](https://developer.apple.com/financekit))
  - 영국: iOS 18.4 이상, 오픈뱅킹으로 Barclays, HSBC, Monzo 등 13개 기관 ([출처](https://developer.apple.com/financekit))
- 그 외 조건:
  - 유료 Developer Program 계정에 entitlement를 받아야 하고, Account Holder가 신청하며 bundle ID 단위로 부여돼요. ([출처](https://developer.apple.com/financekit))
  - 앱이 Finance 카테고리로 미국 또는 영국 App Store에 배포돼야 해요. ([출처](https://developer.apple.com/financekit))

**3. 문자/푸시 직접 읽기는 불가, 단축어 자동화는 가능**
- **직접 읽기:** Apple 포럼 답변에 따르면 서드파티 앱은 메시지 DB를 전혀 읽을 수 없어요. 유일한 예외는 스팸 필터인데, 이것도 모르는 번호의 메시지만 보고 저장·반출은 못 해요. ([출처](https://forums.developer.apple.com/forums/thread/818261)) 다른 앱의 푸시를 읽는 공식 API도 없어요(2차 출처: Stack Overflow 답변들).
- **단축어 '메시지' 자동화:** Apple 문서에 '메시지'가 확인 없이 자동 실행 가능한 자동화 목록에 포함 ([출처](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios))돼 있어요. 다만 개별 동작도 자동 실행으로 설정해야 할 수 있다 ([출처](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios))는 단서가 붙어요. 트리거 조건은 보낸 사람, 메시지 포함 문구 ([출처](https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios))로 걸 수 있어요.
- **App Intent로 넘기기:** `@Parameter`로 입력을 받는 구조 ([출처](https://developer.apple.com/documentation/appintents/appintent))라서 '단축어 입력'(문자 본문)을 텍스트 파라미터로 넘길 수 있어요. 백그라운드 실행은 iOS 26부터 `supportedModes = .background`로 지정해요. ([출처](https://developer.apple.com/documentation/appintents/appintent/supportedmodes)) 기존 `openAppWhenRun`은 26.0에서 deprecated ([출처](https://developer.apple.com/documentation/appintents/appintent/openappwhenrun))됐어요.
- **한국 실사례:**
  - 편한가계부: 카드사 번호를 트리거로 '편한가계부에 추가' 동작에 '단축어 입력'을 넘기고, '즉시 실행'을 권장해요. ([출처](https://www.korea-iphone.com/blog/bJGROcaknXHJ.html))
  - 함쓰: App Intent 대신 웹 요청(POST)으로 문자 본문을 서버에 보내요. ([출처](http://manual.gglab.app/hammss/automation/ios-shortcuts))
  - 다만 일부 후기는 알림을 눌러 직접 '실행'해야 했다 ([출처](https://www.korea-iphone.com/blog/kbyITsCMdnjs.html))고 하고, iOS 17 시절엔 실행 알림을 끌 수 없었다 ([출처](https://vlans.me/30))는 보고도 있어요. 설정 방식과 iOS 버전에 따라 다르니 실기기 검증이 필요해요.
  - iOS 27부터는 설정 이름이 'Confirm Before Run' 끄기 + 'Allow Running When Locked' 켜기 ([출처](https://www.fwrdsms.com/blog/shortcuts-send-message-without-confirmation))로 바뀌었다고 해요(2차 출처).

**4. 카드 내역 엑셀 (가능, 단 공식 페이지는 로그인 필요라 직접 확인 못 함)**
- 주요 카드사 대부분이 홈페이지 '개인사업자용/세금신고용 이용내역'에서 엑셀을 제공해요. 신한, KB국민, 삼성, NH, 현대, 하나, 롯데 등의 메뉴 경로가 정리돼 있고, 카카오뱅크는 앱에서 이메일로 받아요. ([출처](https://blog.ssem.kr/24))
- 일반 이용내역도 엑셀로 받을 수 있어요. 예: 신한카드 PC 홈페이지 이용내역 하단의 '엑셀저장' ([출처](https://capitalize.kr/%EC%8B%A0%ED%95%9C%EC%B9%B4%EB%93%9C-%EC%82%AC%EC%9A%A9%EB%82%B4%EC%97%AD-%EC%A1%B0%ED%9A%8C)).
- 전부 세무 블로그 같은 2차 출처예요. 카드사마다 열 구성이 달라서 파서는 카드사별로 따로 만들어야 할 거예요(추정).

#### B. Apple 동기화와 배포

**5. CloudKit은 유료 계정 필수, 무료 계정은 7일 제한**
- **유료 필수:** SwiftData 자동 동기화에 필요한 iCloud capability는 활성 Apple Developer 계정(admin 권한)이 있어야 해요. ([출처](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices)) 연회비는 $99/년 ([출처](https://flaviocopes.com/apple-developer-free-vs-paid/))이에요(2차 출처).
- **무료 Personal Team 제약:** App ID 최대 10개, 기기 최대 3대, 기기당 앱 3개까지예요. 프로비저닝 프로파일은 발급 7일 후 만료되고, 만료되면 다시 빌드·설치해야 해요. ([출처](https://developer.apple.com/help/account/basics/about-your-developer-account))
- 무료 계정으로 안 되는 기능: iCloud, 원격 푸시, Sign in with Apple 등 ([출처](https://expo.dev/blog/apple-developer-program-explained-free-vs-paid))(2차 출처). 되는 기능: App Groups, Background Modes 등 ([출처](https://expo.dev/blog/apple-developer-program-explained-free-vs-paid)).
- 그 밖에 iOS 16 이상에선 기기에서 개발자 모드를 켜야 해요. ([출처](https://betadrop.app/free-apple-developer-account))

**6. SwiftData + CloudKit 공식 제약**
- **unique 불가:** CloudKit은 `unique` 옵션을 강제할 수 없어요. ([출처](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices)) 중복 제거는 앱 코드로 직접 해야 해요.
- **관계는 optional, inverse 필요:** 관계는 전부 optional이어야 하고, inverse를 추론할 수 없으면 직접 지정해야 해요. ([출처](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices)) Core Data 문서도 같은 내용이에요: 모든 관계에 inverse 필요, Deny 삭제 규칙 미지원 ([출처](https://developer.apple.com/documentation/coredata/creating-a-core-data-model-for-cloudkit)).
- **속성은 optional 또는 기본값:** 제가 본 Apple 문서 발췌엔 이 항목이 없었어요. 2차 출처로는 모든 속성이 optional이거나 기본값을 가져야 한다 ([출처](https://thorsten-stark.de/posts/2026-07-30-Enabling-iCloud-Sync-For-SwiftData-Part-1))고 해요.
- **충돌 해결:** NSPersistentCloudKitContainer가 last writer wins 정책으로 자동 처리해요 ([출처](https://developer.apple.com/videos/play/wwdc2019/202/))(WWDC19). SwiftData가 이 컨테이너를 그대로 써요.
- **동기화 지연:** 공식 문서엔 "즉시 동기화하지 않는다" ([출처](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices))는 말만 있고 구체적인 수치는 **미확인**이에요. 원격 알림 수신을 위해 Background Modes capability도 필요해요. ([출처](https://developer.apple.com/documentation/swiftdata/syncing-model-data-across-a-persons-devices))
- **공유(CKShare):** Apple DTS 답변은 SwiftData + CloudKit은 공유를 지원하지 않는다 ([출처](https://developer.apple.com/forums/thread/765776))예요. 공유가 필요하면 Core Data(NSPersistentCloudKitContainer)를 쓰라고 권해요.
- **2026 변화:** WWDC26(iOS 27)에서 바뀐 건 Codable 속성, 섹션 단위 fetch, 데이터 스토어 관찰 ([출처](https://developer.apple.com/videos/play/wwdc2026/274/))이에요. 2026년 9월 2차 출처도 여전히 private DB만 지원 ([출처](https://www.hashstudioz.com/blog/swiftdata-vs-core-data-which-should-you-choose/))한다고 해서, 공유나 위 제약 쪽 변화는 찾지 못했어요.

**7. SwiftUI 멀티플랫폼 vs Mac Catalyst**
- iOS, iPadOS, macOS는 타깃 하나를 공유할 수 있어요(watchOS는 별도). ([출처](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target)) Apple은 SwiftUI면 단일 타깃, UIKit+AppKit 조합이면 타깃 분리 ([출처](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target))를 권장해요. 다만 플랫폼별 빌드 설정, 프레임워크, API 차이는 직접 확인해야 해요.
- Mac 목적지는 'Mac'이 멀티플랫폼 기본값 ([출처](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target))이에요. Catalyst는 기존 iPad 앱을 Mac으로 옮기는 용도 ([출처](https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target))예요.
- Catalyst 앱은 Catalyst용으로 표시된 AppKit API만 쓸 수 있어요. ([출처](https://developer.apple.com/documentation/uikit/mac-catalyst)) 새로 SwiftUI로 시작하면 'Mac' 옵션이 최선 ([출처](https://developer.apple.com/videos/play/wwdc2022/110371/?time=708))이라고 WWDC22에서 안내했어요.

**8. Xcode는 필수 (CLT만으로 iOS 빌드 불가)**
- 최신 정식은 Xcode 27.2예요. App Store 기준 다운로드 크기 3.1GB, macOS 26.6 이상과 M1 이상 Mac 필요 ([출처](https://apps.apple.com/us/app/xcode/id497799835?mt=12)).
- Xcode 27은 Apple silicon Mac에서만 설치·실행돼요. ([출처](https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-27-release-notes?changes=la__8)) 설치 후 용량은 약 15GB, 시뮬레이터 런타임은 하나당 8~10GB ([출처](https://grandfactor.github.io/macos-setup/07-command-line-tools-and-xcode.html))예요(2차 출처).
- Command Line Tools만으로는 안 돼요. CLT에는 macOS SDK만 들어 있고, `xcodebuild`는 Xcode에만 포함돼요. ([출처](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools.md)) CLT엔 iOS SDK가 없다는 점은 2차 출처 ([출처](https://scottwillsey.com/building-and-shipping-mac-and-ios-apps-without-ever-opening-xcode))로 확인했어요.

#### C. Apple 이외의 대안

**9. iPhone PWA (홈 화면에 추가한 웹앱)**
- **7일 삭제 정책:** 홈 화면 웹앱의 도메인은 ITP의 7일 삭제 대상에서 제외되고, 데이터도 Safari와 격리돼요. ([출처](https://webkit.org/tracking-prevention/)) 사파리 탭에서 쓰면 7일간 상호작용이 없을 때 스크립트로 저장한 데이터가 삭제 ([출처](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria))될 수 있어요.
- **용량:** iOS 17부터 출처당 최대 디스크의 60%까지 쓸 수 있고, 홈 화면 웹앱도 같은 한도예요. ([출처](https://webkit.org/blog/14403/updates-to-storage-policy/))
- **삭제 위험은 남아요:** 기본은 best-effort라서 저장 공간이 부족하면 삭제될 수 있어요. `persist()` 요청은 홈 화면 웹앱인지 등을 보고 판단해서 허용해요. ([출처](https://webkit.org/blog/14403/updates-to-storage-policy/)) 서버 백업을 권장해요.
- **푸시:** iOS 16.4 이상 홈 화면 웹앱에서 Web Push를 지원해요. ([출처](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)) iOS 18.4부터 Declarative Web Push가 추가됐고, iOS 26부터는 홈 화면에 추가하면 기본으로 웹앱으로 열려요. ([출처](https://openpwa.net/reference/platforms/ios-safari))
- **백그라운드 동기화:** Background Sync는 미지원 ([출처](https://mittl-medien.de/progressive-web-app-ios))이에요(2차 출처). 그리고 PWA도 문자를 읽을 수는 없어요.

**10. Supabase 무료 플랜 (RLS 사용 가능)**
- **용량:** DB 500MB, 파일 스토리지 1GB, egress 5GB, MAU 5만, 활성 프로젝트 2개 ([출처](https://supabase.com/pricing))
- **일시정지:** 1주간 활동이 없으면 일시정지돼요. ([출처](https://supabase.com/pricing)) 기준은 지난 1주간 사용자 DB 쿼리가 충분했는지이고, 하루 몇 건 정도면 보통 유지돼요. 정지 후 1년 안에는 복구할 수 있어요. ([출처](https://supabase.com/docs/guides/platform/free-project-pausing))
- **디스크:** 무료 플랜 디스크는 2GB 고정이고, 95%가 차면 읽기 전용으로 바뀌어요. ([출처](https://supabase.com/docs/guides/platform/database-size))
- **백업:** 자동 백업은 무료 플랜에 포함되지 않아요. ([출처](https://supabase.com/pricing)) 공식 문서도 `supabase db dump`로 직접 외부에 백업하라 ([출처](https://supabase.com/docs/guides/platform/backups))고 권해요.
- **RLS:** Postgres 기능이라 무료 플랜에서도 쓸 수 있어요. 공식 문서는 외부에 노출되는 스키마의 모든 테이블에 RLS를 켜라 ([출처](https://supabase.com/docs/guides/database/postgres/row-level-security))고 해요. 요금표에도 플랜별 제한 항목은 없어요.

#### 결론 요약

| # | 항목 | 결론 |
|---|---|---|
| 1 | 마이데이터/오픈뱅킹 | 개인은 불가. 마이데이터는 금융위 허가(자본금 5억 등), 오픈뱅킹은 핀테크 기업 등의 이용계약·심사 필요. 직접 입력 가계부는 허가 불필요 |
| 2 | FinanceKit | 한국 미지원. 미국(Apple Card/Cash/Savings)과 영국(13개 은행)만, 유료 계정 + entitlement + Finance 카테고리 필요 |
| 3 | 문자/푸시 읽기 | 앱 직접 읽기는 불가. 단축어 '메시지' 자동화는 확인 없이 App Intent/웹 요청으로 본문 전달 가능, 편한가계부·함쓰 실사례 있음 |
| 4 | 카드 내역 엑셀 | 주요 카드사 홈페이지에서 엑셀 다운로드 가능(로그인 필요, 2차 출처 기준). 카드사별 형식 다름 |
| 5 | CloudKit과 무료 계정 | CloudKit은 유료($99/년) 필수. 무료는 7일 만료, 기기 3대, 기기당 앱 3개 |
| 6 | SwiftData+CloudKit | unique 불가, 관계 optional+inverse, 속성 optional/기본값, last-writer-wins, 지연 수치 미공개, CKShare 미지원(2026년에도 변화 없음) |
| 7 | 멀티플랫폼 | SwiftUI면 단일 타깃 + 'Mac' 목적지 권장. Catalyst는 iPad 앱 이식용이고 AppKit 일부만 사용 가능 |
| 8 | Xcode | 27.2, 다운로드 3.1GB(설치 약 15GB+), macOS 26.6+ 및 Apple silicon 필요. CLT만으로는 iOS 빌드 불가 |
| 9 | PWA | 홈 화면 웹앱은 7일 삭제 면제, 용량 디스크 60%, 웹 푸시 가능(16.4+). 용량 부족 시 삭제 위험은 남음, 문자 접근 불가 |
| 10 | Supabase 무료 | DB 500MB/디스크 2GB, 1주 비활성 시 정지, 자동 백업 없음, RLS 사용 가능 |

정리하면 한국에서 개인 개발자가 쓸 수 있는 자동 입력 경로는 사실상 두 가지예요. 단축어 '메시지' 자동화로 문자를 App Intent에 넘기는 방법, 그리고 카드사 엑셀을 가져오는 방법이에요. 단축어 방식은 iOS 버전마다 확인창이나 알림이 다르게 동작한다는 보고가 있어서, 본인 아이폰에서 먼저 테스트해 보는 게 좋아요.
