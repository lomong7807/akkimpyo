# 기간 기반 지출 묶기(이벤트) 조사 기록 (2026-11-18)

Aside 조사 2개의 원문이다. 요약과 판단은 대화에서 전달했고, 설계 문서에 반영할 예정이다.

---

## 부록 A. 기간 묶기 기능을 가진 기존 앱 조사 (Aside 세션 Y5tqDdQToc21Le5G)

조사 결과, **"시작~종료 일시를 정하면 그 기간 거래가 기존 것까지 자동으로 묶이고, 일부만 뺄 수 있는" 기능을 그대로 구현한 앱은 찾지 못했습니다.** 특히 **시·분 단위 범위는 조사한 앱 어디에서도 확인되지 않았습니다.** 날짜 단위이거나 미확인입니다.

공개 페이지만 읽었고 로그인이나 설치는 하지 않았습니다. 날짜는 페이지에 표시된 경우만 적었고, 확인 못 한 항목은 '미확인'으로 두었습니다. "(추론)"이 붙은 칸은 문서들을 조합한 제 판단이고, 문서에 그대로 나온 내용은 아닙니다.

---

#### 1. 글로벌 가계부 앱

| 앱 | 1. 묶음 단위 | 2. 묶는 방식 | 3. 시·분 | 4. 개별 제외 | 5. 카테고리와 별개 축 / 통계 | 6. 가격 | 출처 |
|---|---|---|---|---|---|---|---|
| **Money Lover** | Event. 입력값은 이름·시작일·통화·지갑이고, 공식 도움말에 종료일은 없음 | 기본은 수동. **여행 모드**를 켜 두면 새로 입력하는 거래가 그 이벤트에 자동으로 붙고, 끝나면 직접 꺼야 함. 날짜 범위 소급, 위치·통화 감지는 미확인 | 미확인. 입력값이 "Start Date"뿐 | 자동으로 붙은 이벤트만 떼는 방법은 미확인. 거래별 "Exclude from report"는 있지만 리포트 전체에서 빠지는 기능 | 별개 필드. 이벤트별 통계 구성은 미확인 | 무료는 이벤트 1개, 프리미엄은 무제한. 여행 모드 자체가 유료인지는 미확인 | [Events·Travel Mode 도움말(2024-08-19)](https://moneylover.zendesk.com/hc/en-us/articles/35969009741337-How-to-use-Events-and-Travel-Mode), [거래 편집(2026-07-15)](https://moneylover.zendesk.com/hc/en-us/articles/35483252404889-Create-edit-and-delete-transactions), [Premium](https://moneylover.zendesk.com/hc/en-us/articles/35836986998809-Premium-Main-features-and-purchase-instructions), [스토어](https://web.moneylover.me/store) |
| **Wallet (BudgetBakers)** | Label (거래당 최대 5개). Trips·이벤트 기능은 없음 | ① 수동 ② 라벨 옵션 "Assign to every new Record": 켜 둔 동안 새 기록에 자동 지정(Android·Web 안내에만 있음) ③ Automatic Rules: 조건은 키워드·유형뿐이고 **날짜 조건 없음**. 은행 동기화 거래에만 적용되고, 기존 거래 적용 옵션 있음 ④ 기간 필터 후 일괄 편집 | 미확인 | 자동 라벨 개별 해제는 문서에 없음(미확인). 일괄 편집으로 수정 가능 | 별개 축. 택시·호텔·식사가 같은 여행 라벨이 되는 예시가 있음. 라벨 필터, 라벨로 한정한 예산 가능 | 라벨은 무료(색상만 프리미엄). 규칙은 은행 연결(프리미엄) 전제 | [Labels](https://support.budgetbakers.com/hc/en-us/articles/7076564578066-Utilising-Labels), [Rules](https://support.budgetbakers.com/hc/en-us/articles/7149319175826), [Bulk Edit](https://support.budgetbakers.com/hc/en-us/articles/7150568033938-Bulk-Edit-Records), [Premium](https://support.budgetbakers.com/hc/en-us/articles/7151349344018-Everything-about-Premium) |
| **Spendee** | Label 또는 별도 Wallet | 수동과 일괄 편집만 확인. 자동 분류는 카테고리만 대상. 1회성 예산 "Custom (Once)"은 시작일~종료일을 받음 | 미확인 | "Exclude from Overview"는 개요 전체에서 빠지는 기능. 라벨에서만 빼는 기능은 미확인 | 별개 축("데이트" 예시 있음). 사용자 지정 예산을 라벨로 한정 가능 | 무료는 거래당 라벨 1개. Plus $3.99/월, Premium $7.99/월. 일괄 편집은 Premium | [Labels](https://www.spendee.com/help/labels), [Budgets](https://www.spendee.com/help/budgets), [Overview 제외](https://www.spendee.com/help/all-wallets-overview), [요금](https://www.spendee.com/help/is-spendee-free) |
| **MoneyWiz** | Tag, 그리고 일회성 **Budget**. Groups는 폴더일 뿐 | 태그는 수동·일괄. 사용자 규칙 엔진은 없고 자동 분류는 카테고리만. **Budget은 기간+계좌+카테고리(태그는 선택) 조건으로 자동 포함되고, 시작일을 과거로 잡으면 소급됨** | 거래에는 날짜·시간 필드가 있지만 예산은 날짜 단위. 은행 연동은 "Date, Amount, Description 정도만 받음" | **예산·리포트 태그 조건에 `NOT 태그` 같은 논리식 가능** (제외할 거래에 태그를 직접 붙여야 함) | 별개 축. 카테고리×태그 리포트 있음 | 무료 / Standard $29.99/년 / Premium $59.99/년 | [Budget 생성](https://help.wiz.money/a/how-to-create-an-expense-budget-4440638), [고급 태그 조건](https://help.wiz.money/a/how-to-use-advanced-tag-conditions-to-boost-your-budgeting-and-reporting-5546019), [은행 데이터](https://help.wiz.money/en/articles/4440661), [리포트](https://help.wiz.money/en/articles/4440626-generating-reports), [가격](https://wiz.money/pricing) |
| **YNAB** | Flag (공식 권장은 Vacation 카테고리 + 메모) | 수동·일괄. 규칙은 Payee 이름 바꾸기뿐이고 **날짜 조건·플래그 자동 지정 없음**. 검색에서 날짜 Before/After 가능 | 미확인 | 플래그 직접 해제. 검색은 Except(제외) 불가 | 별개 축. 리포트에서 플래그 필터는 미확인 | $14.99/월, $109/년 | [Flags(2026-07-29)](https://support.ynab.com/en_us/flags-a-guide-Skh8Xb4kj), [검색](https://support.ynab.com/en_us/searching-transactions-a-guide-r1gxyQryj), [Payee 규칙](https://support.ynab.com/en_us/how-to-rename-payees-BkotNUSyo), [가격](https://www.ynab.com/pricing) |
| **Monarch** | Tag | 수동·일괄 + 규칙 "Add tags". 조건은 문구·가맹점·금액·카테고리·계좌 등이고 **날짜 조건 없음**. 기존 거래 소급 가능 | 미확인 (리포트는 날짜 범위) | 태그 직접 해제. Hide는 예산·리포트 전체에서 빠지는 기능 | 별개 축. Reports에서 태그+기간 필터 | Core $99.99/년·$14.99/월. 태그·규칙의 플랜 제한은 미확인 | [Tags](https://help.monarch.com/hc/en-us/articles/4409690120596), [Rules(2026-11-05)](https://help.monarch.com/hc/en-us/articles/360048393372), [Hide](https://help.monarch.com/hc/en-us/articles/4405041904916), [Reports](https://help.monarch.com/hc/en-us/articles/21846787088916-Using-Reports), [가격](https://www.monarch.com/pricing) |
| **Copilot Money** | Tag | 수동·일괄. 규칙은 카테고리만 바꾸고 날짜 조건 없음. **Money Assistant(iOS, 베타)에 "다음 주 거래 전부에 Rome 태그" 같은 기간 지시를 하면 멈추라고 할 때까지 자동 적용.** 소급 여부는 미확인 | 미확인 (자연어 기간) | 태그 직접 해제. Recurrings는 차트에서 자동 제외 | 별개 축. 태그 필터 시 월별 합계 | $109/년 (정가 $119), App Store $18/월 | [Tags](https://help.copilot.money/en/articles/9554342-tags), [규칙](https://help.copilot.money/en/articles/3971270-creating-name-rules), [Money Assistant](https://help.copilot.money/en/articles/14462982-money-assistant-overview), [App Store](https://apps.apple.com/us/app/id1447330651) |
| **Lunch Money** | Tag. 이벤트·여행 예시가 공식 문서에 있음 | 수동·일괄 + 규칙 "Add tag". 조건은 Payee/Category/Notes/Amount/**Day range**/Account. Day range는 '월 중 며칠' 범위로 보임(공식 문서 페이지의 AI 답변 근거라 약함). 기존 거래에 적용 가능 | 시각은 조건이 아님 (같은 AI 답변) | 조건에 not 연산자 없음. 소급 적용할 때 대상에서 일부 해제 가능. 태그 개별 해제 | 별개 축. Query Tool에서만 분석 가능하고, Stats/Trends와 예산에는 태그 미반영 | 모든 기능 포함. $10/월, 연간은 금액 직접 선택(최저 $60) | [Rules](https://support.lunchmoney.app/setup/rules.md), [Tags FAQ](https://support.lunchmoney.app/setup/tags/faq.md), [태그 분석](https://support.lunchmoney.app/setup/tags/analyzing-tags.md), [가격](https://lunchmoney.app/pricing) |
| **Toshl** | Tag, 그리고 **일회성 예산** | 태그는 수동(은행 거래는 학습 기반 자동). **여행용 일회성 예산: 여행 날짜를 넣으면 그 기간 지출을 자동 집계.** 카테고리·태그·계좌 포함/제외 가능, 과거 시작일이면 소급 | 날짜 단위만 (API 날짜 YYYY-MM-DD) | 카테고리·태그·계좌 단위 제외만 가능. 거래 1건 제외는 문서에 없음 | 별개 축. 카테고리·태그별 그래프 | 무료는 예산 2개. Pro $19.99/년, Medici(은행 연동) $39.99/년 | [여행 관리(2019-04-17)](https://toshl.com/blog/how-to-manage-money-when-travelling), [예산](https://toshl.com/blog/how-to-use-the-budgets-web-app), [API](https://developer.toshl.com/docs/budgets/create), [가격](https://toshl.com/pricing) |
| **Actual Budget** | 메모 속 **#tag** | **규칙 조건에 date가 있음** (is/gt/gte/lt/lte). 'is between'은 금액에만 있어서 gte+lte 두 조건을 AND로 묶어 날짜 범위를 만듦(추론, 공식 예시 없음). 액션으로 메모에 #태그를 붙이고, 기존 거래는 골라서 소급, 가져오기 때마다 자동 실행 | 날짜 단위만 | **payee `is not`/`not one of` 조건으로 제외 가능** | 별개 축. 태그+날짜 필터 가능, 26.11.0(2026-11-01)부터 커스텀 리포트를 태그별로 그룹화 | 무료 오픈소스, 셀프호스팅(호스팅 비용 별도) | [Rules](https://actualbudget.org/docs/budgeting/rules), [Tags](https://actualbudget.org/docs/transactions/tags), [Filters](https://actualbudget.org/docs/transactions/filters), [Releases](https://actualbudget.org/docs/releases), [소스 rules.ts](https://github.com/actualbudget/actual) |

#### 2. 여행 전용 앱

| 앱 | 1 | 2 | 3 | 4 | 5 | 6 | 출처 |
|---|---|---|---|---|---|---|---|
| **트라비포켓** | 여행 (+여행 폴더) | 여행 안에서 수동 입력 또는 AI 영수증. **시작일 이전 날짜의 지출은 '준비' 탭에 자동 분류.** 카드 연동은 문서에 없음 | 지출마다 시간은 기록됨(CSV에 시간 열). 여행 경계는 시작일(날짜) 기준 | 미확인 | 여행은 상위 장부. 날짜·카테고리·동행자·통화별 통계 | 기본 무료. KR Pro ₩29,000/년·₩3,300/월. 7일·30일 패스 금액은 미확인 | [FAQ](https://trabeepocket.com/ko/faq), [App Store KR](https://apps.apple.com/kr/app/id673659438) |
| **TravelSpend** | trip (시작·종료일) | 수동. **iOS 단축어로 Apple Pay 자동화를 설정하면 결제가 지정한 trip에 자동 추가.** 은행 연동 없음 | 날짜 단위. 시·분은 미확인 | **"Exclude From Daily Metrics"**: 일평균에서는 빠지지만 trip 총예산에는 남음 | 별개 축. 일·카테고리·국가별 차트 | Premium $4.99/$24.99, Lifetime $59.99 (US) | [Apple Pay 자동화](https://help.travel-spend.com/shortcuts--automation/ignQHsp85RQDsig2QwVcdX/set-up-apple-pay-automation/7tL8XfjBceg4D7mQeiSK2V), [제외](https://help.travel-spend.com/daily-metrics/nsEZBhRKe4aEiaHGB4fnwF/how-to-exclude-expenses-from-the-daily-metrics/sHk7PpivXUXGPwy731qgj6), [App Store](https://apps.apple.com/us/app/travelspend-travel-budget-app/id1434284824) |
| **Tripcoin** | trip | 수동. 지출 위치 저장(리뷰상 현재 도시가 기본값으로 잡힘) | 지출에 날짜·시간 입력 가능. trip 기간은 미확인 | 미확인 | 별개 축. 국가·결제수단 필터 | 무료, Pro $4.99 | [App Store](https://apps.apple.com/us/app/tripcoin-travel-budget/id896518806), [TPG(2022-01-16)](https://thepointsguy.com/news/apps-track-travel-expense) |
| **Trail Wallet** (배포 중단) | trip | 수동. 반대로 trip 날짜를 첫·마지막 항목 날짜로 자동 계산하는 옵션이 있음 | 날짜 | 제외 기능 없음. 큰 지출은 "Extras" trip으로 분리하라고 안내 | trip·카테고리·태그 별개 | 1회 결제 (과거 $4.99) | [공식](https://voyagetravelapps.com/trail-wallet), [FAQ](https://voyagetravelapps.com/trail-wallet-faq) |
| **Splitwise** | 그룹 (유형에 trip, couple 있음) | 수동. Pro의 Transaction import는 골라서 추가. 미국 Splitwise Card의 auto-split은 카드 결제를 기본 그룹에 전부 넣음 | 그룹 기간 개념은 미확인 | 미확인 | 정산 축. 차트는 Pro | 무료는 하루 4건, Pro 금액은 미확인 | [Pro](https://www.splitwise.com/pro), [Card](https://www.splitwise.com/card) |
| **Tricount** | tricount(그룹) | bunq·무료 카드 결제를 선택한 tricount에 자동 추가. 최근 90일 bunq 결제를 하나씩 골라 추가 가능 | 기간 개념은 미확인 | 미확인 | 카테고리 파이차트 | 무료 (Premium 폐지) | [카드](https://help.tricount.com/articles/how-do-i-use-my-free-credit-card), [bunq 결제](https://help.tricount.com/en/articles/add-bunq-payments-as-expenses), [FAQ](https://help.tricount.com/en/articles/tricount-faqs) |

#### 3. 한국 앱

| 앱 | 1 | 2 | 3 | 4 | 5 | 6 | 출처 |
|---|---|---|---|---|---|---|---|
| **편한가계부** | 태그 | 거래마다 수동, 검색에서 태그 검색 | 통계 기간 임의 설정 가능. 시각은 미확인 | 해당 없음 (수동) | 분류와 별개. 태그별 통계 화면은 미확인 | 무료 / 9,900원 / 월 2,900원·연 24,000원 | [Play](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree), [도움말](https://help.realbyteapps.com/hc/ko/articles/360042842734), [가격](https://ko.realbyteapps.com) |
| **뱅크샐러드** | 메모 해시태그(#전주여행), 내역 합치기(여러 건을 1건으로) | 둘 다 수동 | 필터는 기간 단위. 시각은 미확인 | 해당 없음 | 별개 축 (식사 vs 여행 고민을 태그로 해결한다는 공식 설명) | 미확인 | [한경(2021-10-25)](https://www.hankyung.com/article/2021102524306), [도움말](https://help.banksalad.com/0f313b5e-7f36-827a-950d-01b186ccb96e), [Play](https://play.google.com/store/apps/details?id=com.rainist.banksalad2) |
| **토스** | 사용자 태그는 미확인. 모임통장, 함께 쓰는 캘린더(최대 2명) | 캘린더는 공유할 소비를 골라서 불러옴(수동). 모임통장은 그 계좌 거래가 자동 포함 | 미확인 | **카드 소비에서 거래별 '지출 합계에 포함' 끄기** (검색 발췌로만 확인) | 카테고리 자동 분류. 별도 축은 미확인 | 미확인 | [FAQ](https://support.toss.im/faq/5035), [디데일리(2025-11-11)](https://www.ddaily.co.kr/page/view/2025111109365762164), [토스뱅크](https://www.tossbank.com/articles/newlyweds-bank) |
| **후잉** | 태그 없음. 아이템 괄호 표기, 섹션(별도 장부) | 수동 | 날짜 단위 | 해당 없음 | 별개 축 없음 (여행 계정을 따로 만들면 식비 통계에서 빠짐) | 월 3,900원 | [도움말](https://whooing.com/help/entries), [리포트](https://whooing.com/help/reports), [가격](https://whooing.com/zhnl), [개인 블로그 후기(2024-11-10)](https://blog.woojinkim.org/two-people-using-whooing-ledger) |
| **위플** | Pro의 '가계부 여러 개' | 미확인 | 미확인 | 미확인 | 미확인 | Pro 있음, 금액은 미확인 | [도움말](https://withweple.com/help/) |
| **네이버 가계부** | 미확인 (종료 공지는 못 찾음, 2026-05-29 업데이트) | 문자·카드 자동 등록 | 미확인 | 미확인 | 분류별 통계 | 무료로 보임(미확인) | [Play](https://play.google.com/store/apps/details?id=com.nhn.android.moneybook) |
| **카카오뱅크 모임통장** | 계좌 | 그 계좌 거래 자동 포함 | 월 단위 화면 | **"포함할 내역, 제외할 내역 설정"** (가족·생활비 모임만) | 미확인 | 미확인 | [상품 페이지](https://www.kakaobank.com/products/moim) |
| **트리플 가계부** | 2026-11-03 NOL 통합 때 가계부 기능 제거 | - | - | - | - | - | [pickycut(2026-11-04)](https://pickycut.com/posts/triple-shutdown-nol-migration-collaborative-travel-planner-apps-comparison) |
| **트래블월렛** | N빵 결제 그룹 확인. 지출 묶음 관련 항목은 전부 미확인 | | | | | | [공식](https://www.travel-wallet.com/ko) |
| **커플 가계부** (가계부부, 우리알지) | 공유 가계부 | 수동 | 미확인 | 미확인 | 사용자별 통계(가계부부) | 각각 광고 제거·구독 월 1,900원 / 연 19,000원 | [가계부부](https://play.google.com/store/apps/details?id=dev.hwiveloper.ggbb), [우리알지](https://apps.apple.com/kr/app/id6760098343) |

#### 4. 카드·핀테크

| 서비스 | 1 | 2 | 3 | 4 | 5 | 6 | 출처 |
|---|---|---|---|---|---|---|---|
| **Revolut Trips** | trip (나라 단위, 서로 겹치지 않음) | **위치 변경 또는 그 나라 첫 결제로 시작, 귀국 위치나 본국 결제로 종료를 자동 감지. 과거 내역에서도 소급 탐지.** 국가·날짜·거래를 골라 수동 추가도 가능 | 'dates'로만 표현됨. 시·분은 미확인 | **trip의 날짜와 포함 거래를 수정 가능** | 별개 축. 종료 후 일별·카테고리 요약 푸시 | 플랜 제한은 미확인 | [Using Trips](https://help.revolut.com/en-US/help/accounts/budget-and-analytics/revolut-trips-using-revolut-trips), [Trip 정의](https://help.revolut.com/help/accounts/budget-and-analytics/revolut-trips-how-is-a-trip-defined/), [블로그(2025-11-18)](https://www.revolut.com/blog/post/the-people-behind-trips) |
| **Monzo** | travel report, #tag | 귀국 후 해외 지출 자동 보고. 태그는 수동 | 미확인 | Trends는 카테고리 단위로만 제외. 거래 단위 제외가 되던 Summary는 2025-12-21 종료 | 태그는 별개 축 | 커스텀 카테고리는 유료 플랜 | [여행 전후(2026-10-28)](https://monzo.com/learn/money-abroad/things-to-know-pre-and-post-trip), [Trends 제외](https://monzo.com/help/budgeting-overdrafts-savings/trends-excluded-transactions), [Summary 종료](https://community.monzo.com/t/retiring-the-summary-feature/186087) |
| **N26** | #hashtag, Space | 시간·위치 자동 태그(#weekend, #berlin) + 수동 태그. Space는 연결한 가상카드 단위로 분리 | 미확인 | 태그 제거 | 별개 축 (Insights) | Spaces는 Smart 이상 | [지출 추적](https://support.n26.com/en-eu/payments-transfers-and-withdrawals/balance-and-limits/how-to-keep-track-of-my-daily-spending), [블로그(2024-07-04)](https://n26.com/en-es/blog/keep-vacation-spending-in-check) |
| **Starling** | 태그 (최대 5개, "Honeymoon" 예시) | 수동 + AI 태그(가맹점·날짜·시간·금액 기반) | 미확인 | 태그 제거 | 공식적으로 별개 축 | 미확인 | [Tags](https://help.starlingbank.com/personal/topics/account-support/what-are-transaction-tags-and-what-can-i-do-with-them/), [AI tags](https://help.starlingbank.com/personal/topics/using-the-app/what-are-ai-transaction-tags-and-how-do-they-work/) |
| **기타** | Apple Wallet, Wise, Curve, Chase/Amex에는 trip 묶음 없음(미확인). Google Wallet은 2026-11-13부터 Gemini에 "작년 여행에 쓴 돈" 같은 자연어 질의 가능 | | | | | | [Apple](https://support.apple.com/en-us/102329), [Google 블로그](https://blog.google/innovation-and-ai/products/gemini-app/google-wallet-gemini-app), [Curve](https://help.curve.com/en_gb/spending-with-curve-SyUTsUIUxe) |

---

#### 요약

**아이디어와 가장 가까운 Top 3**

1. **Revolut Trips**: 기간 안의 거래가 자동으로 묶이고, 과거 내역에도 소급되며, 날짜와 포함 거래를 고칠 수 있습니다.
   - 차이점: 단위가 '해외 한 나라 방문'으로 고정돼 있어 국내 데이트 같은 사용자 정의 이벤트는 만들 수 없습니다.
   - 시작과 끝을 사용자가 일시로 정하는 게 아니라 위치·결제로 감지합니다. 시·분 단위는 미확인입니다.
   - 자동결제 같은 유형을 규칙으로 빼는 기능도 없습니다.
2. **Actual Budget 규칙**: 날짜 이후(gte)·이전(lte) 조건으로 범위를 잡고, `payee not one of` 조건으로 자동결제 가맹점을 빼고, 메모에 #태그를 붙이는 방식입니다. 기존 거래 소급과 이후 가져오기 자동 적용까지 됩니다.
   - 차이점: '이벤트'라는 화면이 없어서 규칙을 손으로 만들어야 합니다.
   - 날짜 단위만 됩니다.
   - 범위 조합은 문서 예시가 없는 제 추론입니다.
3. **MoneyWiz / Toshl의 일회성 예산**: 시작일~종료일을 넣으면 그 기간 지출이 과거분까지 자동 집계되고, `NOT 태그`(MoneyWiz)나 카테고리·태그·계좌 단위(Toshl)로 제외할 수 있습니다.
   - 차이점: 거래에 이벤트가 붙는 게 아니라 예산 합산일 뿐입니다.
   - 날짜 단위입니다.
   - 거래 1건만 빼려면 제외용 태그를 따로 붙여야 합니다.

번외로 **Money Lover 여행 모드**는 "켜 둔 동안 새 거래 자동 연결"이라 사용감은 가장 비슷합니다. 하지만 날짜 범위가 아니라 직접 켜고 끄는 방식이고, 소급과 예외 제외는 확인되지 않았습니다.

**"날짜·시간 범위로 자동 포함 + 예외 제외"를 그대로 구현한 앱: 찾지 못함.** 이벤트 화면에서 시작·종료 일시(시·분)를 정하고, 그 범위의 기존·신규 거래가 자동으로 묶이고, 자동결제·온라인 주문 같은 거래를 개별 또는 규칙으로 빼는 조합은 조사한 40여 개 서비스 어디에도 없었습니다.

참고로 시·분 단위를 구현하려면 거래에 결제 시각이 있어야 합니다. MoneyWiz 문서는 은행 연동 거래가 대부분 날짜·금액·설명만 받는다고 안내합니다. 다른 앱의 연동 거래에 시각 정보가 있는지는 미확인입니다.

---

## 부록 B. 여행·데이트 지출 관리 실태 조사 (Aside 세션 Set8mJ6oOgvreW9q)

I used parallel workers to split the reading across 7 sources: two Reddit groups, the apps' feature-request boards and help docs, App Store reviews, Korean communities, dating budgets and the edge cases. I opened the two key items myself (Lode's trip help page and Copilot's homepage). Upvote counts are as of 2026-11-18. I left out usernames and nicknames.

### 결론

- **불편은 분명히 있어요.** 사람들은 이미 같은 일을 손으로 하고 있습니다. 날짜 필터로 모아서 한꺼번에 태그를 달거나, 여행 카테고리를 새로 만들었다가 지우거나, "여행비 빼면 이번 달 얼마"를 직접 계산합니다.
- **"날짜 범위로 자동으로 묶어 달라"는 요청 글 자체는 못 찾았어요(미확인).** 공식 게시판에서 여행 관련 요청은 대부분 4~19표 수준입니다.
- **이 기능을 이미 만든 앱이 있습니다.** Lode가 거의 같은 구조이고, Copilot은 AI 기능의 대표 예시로 여행 자동 태그를 내세웠어요(아래 "이미 만든 앱" 참고).

---

#### 1. 지금 어떻게 기록하나

**해외(Reddit, 앱 리뷰)**
- **여행 카테고리 하나에 전부 넣기.** 가장 흔한 방식입니다.
  - "I put it all under the Vacation category. This includes things that would normally go into categories like Gas, Restaurants" (r/ynab 2022-08-26, 댓글 82점) https://old.reddit.com/r/ynab/comments/wyada9/
  - Monarch 쪽 최상위 댓글(120점): "Don't you want to be able to see how much your trip cost at a glance?" (2026-05-28) https://old.reddit.com/r/MonarchMoney/comments/1tqbige/
- **여행마다 카테고리를 만들고, 끝나면 숨기거나 삭제하기.** "this is insanely tedious"라는 반응이 붙었습니다. (r/ynab 2026-01-04) https://old.reddit.com/r/ynab/comments/1q42dso/
- **메모 접두어나 해시태그.**
  - 메모 형식 "[Destination] Trip [Year]" (r/ynab 2023-02-09, 93점) https://old.reddit.com/r/ynab/comments/10xwuvf/
  - "#Orlando2026" (r/copilotmoney 2026-06-30) https://old.reddit.com/r/copilotmoney/comments/1uj9k0w/
- **원래 카테고리는 두고 여행 태그만 추가.** "How much did I spend on restaurants on our trip to NYC?"에 답할 수 있다는 이유입니다(23점). URL은 1tqbige와 같습니다.
- **귀국 후 날짜 필터로 한꺼번에 태그(사실상 수동 기간 묶기).** "when we get home, we bulk tag all transactions (using the date filter)… Then I create a report based on that tag" (r/MonarchMoney 2025-12-30, 31점) https://old.reddit.com/r/MonarchMoney/comments/1pzx6dx/
- **엑셀이나 스프레드시트를 같이 쓰기.**
  - "keep a simple spreadsheet of trip summaries" (r/ynab 2025-11-03) https://old.reddit.com/r/ynab/comments/1on0e4o/
  - 여러 달에 걸친 이벤트는 엑셀로 관리하고 앱 피드에서는 숨긴다는 리뷰 (Monarch App Store US, 2025-04-17, 3점) https://itunes.apple.com/us/rss/customerreviews/page=1/id=1459319842/sortby=mosthelpful/json

**한국**
- **여행 통장을 따로 두고 가계부에서는 빼기.**
  - "여행비용은 모두 예산/결산에서 제외… 매달 지출이 들쑥날쑥하여 따로 통장을 두고 관리" (2024-08-17) https://blog.naver.com/hee-eee/223551232663
  - "여행통장에서 지출해서 가계부에 작성하진 않음" (2024-02-19) https://blog.naver.com/shjsykkh1222/223357964510
- **경조사나 연간비용 통장을 따로 두기.** "5월 같이 행사가 많은 달에는… 스트레스" 때문에 "가계부와 완전 분리된 별도의 통장"을 만들었다고 합니다. (2021-06-19) https://blog.naver.com/ellyz_note/222403317753
- **태그.** "특수한 용도는 회식, 모임, 데이트로 태그" (클리앙 2019-03-31) https://www.clien.net/service/board/park/13325243
- **여행 전용 앱을 따로 쓰기.**
  - "평소 사용하는 가계부어플이 있기는 하지만 여행지출은 따로 한 눈에" 보려고 트라비포켓을 씀 (2024-02-18) https://blog.naver.com/nahoo_1330/223357329672
  - 트라비포켓을 결혼준비·출산준비 같은 "총비용 알고싶은 개인적인 이벤트"에도 씀 (App Store KR 2018-11-12) https://itunes.apple.com/kr/rss/customerreviews/page=2/id=673659438/sortby=mosthelpful/json
- **노션이나 엑셀에 따로 정리하고, 가계부에는 총액만 넣기.**
  - 이사: "노션에 따로 정리를 했고 총비용만 가계부에 기록" (2024-11-03) https://blog.naver.com/favorite_74/223644984300
  - 클리앙 2015 질문에 "여행별로 시트"를 만들라는 답변 (2015-09-08) https://www.clien.net/service/board/cm_iphonien/8098102
- **결산할 때 손으로 빼서 계산하기.** "1월 일본 가족여행 비용 203만원 제외하면 128만원 정도" (2024-01-01) https://blog.naver.com/foodscenestealer/223308760615

#### 2. 불만과 요구 (추천 수, 개발사 답변)

- **여행별 리포트 요청 (Monarch 팀에게 직접 질문).**
  - 글 47점: "create one travel tag per trip… you end up with too many tags", "you have to type a note for every transaction"
  - Monarch 팀 답변: "I am crowdsourcing some ideas with the team and will report back!" 이후 결과는 미확인입니다.
  - (2026-03-01) https://old.reddit.com/r/MonarchMoney/comments/1rhvquz/
- **일회용 여행 태그가 쌓이는 문제.**
  - Monarch 글 43점에 팀 답변이 26점이었고, 내용은 "this one in particular I agree with!"입니다. (2026-10-19) https://old.reddit.com/r/MonarchMoney/comments/1x9yz5q/
  - Simplifi "Ability to Archive Tags" 19표, 상태 Active (2023-03-21) https://community.simplifimoney.com/discussion/4651/ability-to-archive-tags
- **태그 합계가 안 나온다 (Copilot).**
  - "Is there a way to see the total for a tag? … get out a calculator" (2024-10-14, 18점) https://old.reddit.com/r/copilotmoney/comments/1g3ac4l/tags/
  - 이후 개발사가 선택한 거래의 합계를 보여주는 기능을 냈고, 공지에 "many of you asked for a way to total just the transactions you pick"라고 적었습니다. (2026-10-08, 31점) https://old.reddit.com/r/copilotmoney/comments/1x14glt/
- **평소 통계가 망가진다.**
  - "all the spending I did on vacation is making it look incredibly inflated" (2026-05-28, 37점, 1tqbige)
  - 한국: "가계부가 왜곡될 정도로 큰 금액은 따로 빼주는 센스" (2022-12-28) https://blog.naver.com/1216g0/222968188893
- **여러 달에 걸친 여행 총액을 보고 싶다 (가장 직접적인 국내 근거).** "여행에 쓰이는 돈은 따로 모아서 볼 수 있는 기능… 여러 달에 걸친 돈을 계산하려니 조금 힘들어서요" (위플 App Store KR 2025-08-20) https://itunes.apple.com/kr/rss/customerreviews/page=2/id=467936485/sortby=mosthelpful/json
- **태그 다는 게 귀찮다.**
  - "there's no real tagging feature in YNAB, and bulk editing memos isn't possible, so this gets tedious" (1on0e4o)
  - "I find it tedious and still didn't have the desired reporting result" (1pzx6dx)
  - 다녀와서 접두어를 한꺼번에 붙이고 싶다는 수요도 있습니다: "add the same prefix 'Hawaii 2022' to all of them" (10xwuvf)
- **제외 기능이 번거롭거나 오히려 해가 된다.**
  - 토스의 '지출 합계에 포함' 토글을 "일일이 이걸 바꿔주는 것도 꽤 번거로운 일" (2021-03-27) https://brunch.co.kr/@jwj8906/23
  - "틈만 나면 예산 내역 제외… 제대로 관리는 하지 못하고 있었다" (2024-03-30) https://blog.naver.com/iamstellalee/223400514171
- **공식 게시판의 표 수는 작아요.**
  - Lunch Money "2주를 vacation으로 표시하고 그 기간 지출 보기" 요청은 **6표**입니다. (2025-03-17) https://feedback.lunchmoney.app/calendar/p/add-tags-tasks-events-notes-reminders
  - Actual Budget 태그 요청(#4806)은 👍13이고, 메인테이너 답변은 "You can add #tags… in the notes"였습니다. https://github.com/actualbudget/actual/issues/4806
- **"날짜 범위로 한꺼번에 태그"를 직접 요청한 글은 미확인입니다.** 국내 커뮤니티에서도 같은 표현은 못 찾았습니다.

#### 3. 기간 기반 묶기의 함정 (실제 사례)

- **미리 결제한 항공권과 숙소 (기간 밖).**
  - "Some expenses may occur MONTHS in advance" (1rhvquz)
  - 7월에 10월 여행 항공권을 사니 "totally skews my spending for the month" (2024-10-04) https://old.reddit.com/r/MonarchMoney/comments/1fw3pws/
  - "Of course the exception to that is prepaid expenses like airfare" (r/ynab 2023-09-11) https://old.reddit.com/r/ynab/comments/16fwwhx/
  - 국내: 3월 지출의 25%가 4월 제주 항공권과 숙소였다는 사례 (iamstellalee 글)
- **출발 전 준비비용은 일평균에서 빼고 싶다.**
  - "flights… prior to the trip… would change the daily average" (Tripcoin App Store US 2019-04-07) https://itunes.apple.com/us/rss/customerreviews/page=2/id=896518806/sortby=mostrecent/json
  - "준비 비용은 여행비용에 합쳐지지 않고 별도로 표시" (트라비포켓 App Store KR 2022-12-31) https://itunes.apple.com/kr/rss/customerreviews/page=7/id=673659438/sortby=mosthelpful/json
- **기간 안이지만 여행과 무관한 지출.**
  - "if we do shopping for gifts or clothes while away, those usually go in their normal budget" (38점, 날짜 미확인) https://www.reddit.com/r/MonarchMoney/comments/18w259i/
  - 장보기처럼 "purchases I'd have made even at home"은 평소 카테고리에 남긴다 (wyada9)
  - **여행 중 빠져나간 구독료·월세·보험료에 대한 사용자 불만은 미확인입니다.** 다만 Lode는 이걸 기본 예외로 처리합니다(아래 참고).
- **기간 밖이지만 여행에 들어가는 지출.** 여행 중 집에서 생긴 반려견 맡김 비용을 여행에 포함 (38점, 18w259i)
- **승인일과 게시일·매입일 차이.**
  - "Why doesn't Monarch use the transaction date instead of the posted date?" (2025-08-14, 81점), 날짜가 "a day or two off" https://old.reddit.com/r/MonarchMoney/comments/1mpztv8/
  - 토스뱅크 공식: 해외 결제는 승인 뒤 매입이 따로 들어오고, 한 승인이 여러 건으로 나눠 매입될 수 있음. 매입되지 않은 승인은 보통 11일 뒤 자동 취소. https://support.toss.im/faq/tossbank/4163
  - 뱅크샐러드 공식: 해외 결제는 승인 내역과 출금 내역의 시간·금액이 달라 "2개의 내역이 조회될 수 있습니다" https://help.banksalad.com/58
- **해외 시간대.**
  - 우리카드 공식: 체크카드 환율은 "거래일자(한국시간 기준)" https://m.wooricard.com/dcmw/yh1/ugd/ugd02/frguseadv/M1UGD202S45.do
  - 귀국 후 몰아서 입력하면 현지 시간대로 적을 수 없다는 리뷰 (트라비포켓 KR 2024-11-28) https://itunes.apple.com/kr/rss/customerreviews/page=3/id=673659438/sortby=mostrecent/json
  - Monzo 사용자: GMT 기준이라 해외에서 일별 지출이 엉망이 됨 (2018-04-16) https://community.monzo.com/t/transaction-times-days-when-abroad/36386
- **귀국 후 청구.**
  - KB국민카드 공식: 완납 후에도 호텔 미니바, 렌터카 범칙금, 기내면세점 등을 추가 청구할 수 있음. 기내면세점은 "도착한 후 2~3일 후" 승인. https://mobileapps.kbcard.com/SVC/DVIEW/MSDMCXHIASVCD0025?selectedTap=4
  - 실제 사례: 귀국하고 며칠 뒤 호텔이 $160, $102를 추가로 청구 (r/personalfinance 2023-04-05, 760점) https://old.reddit.com/r/personalfinance/comments/12c7640/
- **환불.**
  - 뱅크샐러드 공식: 마이데이터 정책상 매입취소 정보가 전송되지 않아 반영이 어려움. 부분취소는 지출 내역이 남을 수 있음. https://help.banksalad.com/769
  - Copilot 공식: 환불 날짜를 원거래 날짜로 직접 바꾸라고 안내 (2026-09-09) https://help.copilot.money/en/articles/5325170-refund-and-reimbursement-transactions
- **일행 정산과 더치페이.**
  - "50유로를 사용 후 친구한테 25유로를 받은 경우… 쓴돈은 50유로로 반영" (트라비포켓 KR 2025-03-31, 3번 항목 URL과 같은 페이지)
  - 정산금을 같은 카테고리로 넣어 상계하라는 최상위 댓글 125점 (2026-07-09) https://www.reddit.com/r/MonarchMoney/comments/1urxuc4/
  - 정산금이 늦게 들어오는 문제: "I back date my reimbursement" (19점, 2026-04-02) https://old.reddit.com/r/MonarchMoney/comments/1sarf1n/
  - 뱅크샐러드 공식 방법은 수동입니다. 받은 돈은 [이체]로 분류하고, 결제 금액을 내 몫으로 수정합니다. https://help.banksalad.com/66
- **여행끼리 기간이 겹침.** "If your trip dates and deposits do not overlap… set a Date Range. If… overlap… use a tag." (2025-06-04) https://old.reddit.com/r/MonarchMoney/comments/1l34j3y/
- **결혼처럼 여러 달에 나눠 내는 이벤트.** "계약금과 잔금내는 날이 다르다보니" 추적이 어렵다 (2024-02-12) https://blog.naver.com/haru_haru_ing/223350820370
- **충전식 카드(트래블월렛 등).** 출국 전 충전, 여행 중 사용, 귀국 후 남은 외화 환불의 세 시점이 다릅니다. (클리앙 2023-08-21) https://www.clien.net/service/board/use/18259174

#### 4. 한국의 데이트 비용 관리

- **방식.**
  - 모임통장에 매달 입금하고 체크카드로 결제. 카카오뱅크는 "계좌주인만 카드 만들 수 있고 1개밖에 발급"이 돼서 토스로 옮김. (2023-07-17) https://m.blog.naver.com/iam_ming2/223158356509
  - 데이트 통장을 소비·목적(여행·기념일)·파킹 3개로 쪼갠 사례. 그 전에는 "지출내역 파악은 1도 하지 않았다"고 함. (2023-09-12) https://m.blog.naver.com/5489907/223209713402
  - 하위 카테고리 "데이트-데이트 밥값, 데이트-데이트 카페"로 매달 데이트비를 봄 (위플 KR 2018-10-25) https://itunes.apple.com/kr/rss/customerreviews/page=4/id=467936485/sortby=mosthelpful/json
- **불만.**
  - 통장 밖 현금·소액 결제가 섞여 정산 갈등이 생김 (2015-11-19, 퍼온 글이라 원출처는 미확인) https://www.missyusa.com/...idx=3102373
  - 생일·기념일 비용을 데이트 통장으로 낼지를 두고 서운함 (2025-09-30) https://community.rememberapp.co.kr/post/179680
  - 공유 앱이 두 사람 지출을 합산해서 보여주니 "하나하나 들어가서 봐야" 함 (누가 KR 2025-08-26) https://apps.apple.com/kr/app/id6480401011
  - 개인 용돈으로 낸 식비가 부부 식비 예산에 섞임 (너굴부부 KR 2026-08-04) https://apps.apple.com/kr/app/id6526465147
  - 날짜에 "지은이만난날, 거제여행" 같은 제목을 붙이고 싶다 (초록가계부 KR 2026-09-16) https://apps.apple.com/kr/app/id6740523902
- **수요를 약하게 보는 근거.**
  - 데이트 통장 자체에 반감이 큽니다. 네이트판 글이 추천 177, 반대 1,174였습니다. (2012-05-08) https://pann.nate.com/talk/315714283
  - 데이트 통장을 쓰는 사람에게는 그 통장 내역이 이미 이벤트 묶음 역할을 합니다. 따로 기능이 필요 없을 수 있다는 판단이에요.

#### 5. 분리해서 보는 게 도움이 됐나

- **도움이 됐다.**
  - "I commit to trips as a whole… seeing what a whole trip cost the last time we went helps me decide" (10xwuvf)
  - 여행 총액을 다음 여행의 저축 목표로 씀 (1pzx6dx, 31점)
  - 국내: 여행·경조사를 빼면 월 지출이 평탄해짐 (hee-eee 2024, ellyz_note 2021 글)
- **필요 없다.**
  - "I just use a single category for all travel, I don't see that much value in breaking it up" (1pzx6dx)
  - "I'm not running my household finances under GAAP. Cash basis is reality." (12점, 1fw3pws)
  - 태그는 "very few people end up using them" (2024-01-10) https://old.reddit.com/r/ynab/comments/193fcxb/
  - 클리앙 경조사 글은 "내고 잊습니다" 쪽이 다수 (2022-01-07) https://www.clien.net/service/board/park/16850398
- **"카테고리로 충분하다"는 명시적 반대 앱 리뷰는 미확인입니다.**

#### 이미 만든 앱 (가장 중요한 비교 대상)

- **Lode.** 사용자님 아이디어와 거의 같은 구조입니다.
  - 이름과 날짜를 넣으면 그 기간의 모든 지출이 자동으로 여행에 들어가고, 다녀와서 만든 여행도 이미 있는 거래를 가져옵니다 ([출처](https://lodefinance.com/trips)).
  - 출발·귀국 시각을 넣으면 그 전후 지출이 빠지고, '정기 청구 제외'가 기본으로 켜져 있어 여행 중 월세와 구독료는 빠집니다 ([출처](https://lodefinance.com/trips)).
  - 한 달 일찍 산 항공권처럼 기간 밖 지출도 넣을 수 있고, 여행끼리 날짜가 겹칠 수 없습니다 ([출처](https://lodefinance.com/trips)).
  - 통계에 '여행 제외' 필터가 있고, 집에서의 하루와 여행 중 하루의 비용을 비교해 줍니다 ([출처](https://lodefinance.com/trips)).
  - 다만 사용자 반응은 미확인입니다.
- **Copilot.** AI 비서 예시로 "Tag relevant charges as Chile 2026 until Oct 10" ([출처](https://www.copilot.money/))를 홈페이지에 내세우고 있어요. 날짜 범위에 AI의 관련성 판단을 더한 방식입니다. 업체가 이 수요를 대표 사례로 볼 만큼 중요하게 판단한다는 신호입니다.
- **Money Lover Travel Mode.** 켜 둔 동안 새로 입력한 거래만 이벤트에 붙고, 도움말에 "remember to turn off this mode"라고 적혀 있어요(2024-08-19). 토글 방식은 끄는 걸 잊는다는 약점이 있습니다. https://moneylover.zendesk.com/hc/en-us/articles/35969009741337-How-to-use-Events-and-Travel-Mode

---

### 요약

**수요가 있다는 근거**
- 사람들이 수동으로 기간 묶기를 이미 하고 있습니다(날짜 필터로 일괄 태그, 31점).
- Monarch 여행 리포트 글 47점, 태그 보관 글 43점에 팀이 각각 답했습니다.
- Copilot은 태그 합계 요청이 반복된 뒤 선택 합계 기능을 냈습니다.
- 국내 리뷰에 "여러 달에 걸친 여행비를 모아 보고 싶다"는 요청이 있습니다.
- 국내 블로그에서 "여행비 빼면 얼마"를 손으로 계산하는 사례가 흔합니다.
- Lode와 Copilot이 이미 같은 방향으로 기능을 냈습니다.

**수요가 약하다는 근거**
- 날짜 범위 자동 묶기를 직접 요청한 글은 못 찾았습니다(미확인).
- 공식 게시판의 여행 관련 요청은 4~19표 수준입니다.
- "카테고리 하나면 충분하다", "현금 기준이 현실이다" 같은 의견이 꾸준히 있습니다.
- 한국에서는 여행 통장, 트라비포켓, 데이트 통장이 이미 이 역할을 하고 있습니다.
- 국내 리뷰의 기간 조회 요청은 대부분 월급날이나 카드 실적 기준이라 이벤트 묶기와는 다른 수요입니다.

**반드시 처리할 예외 (근거 있는 것만)**

| 예외 | 근거 |
|-|-|
| 기간 전에 결제한 항공권·숙소: 묶음에는 넣고, 1일 평균에서는 빼거나 따로 표시 | 1rhvquz, 1fw3pws, Tripcoin·트라비포켓 리뷰 |
| 기간 안이지만 무관한 지출(선물, 장보기 등)을 건별로 제외 | 18w259i, wyada9 |
| 월세·구독 같은 정기 청구 자동 제외 | Lode 기본값만 확인, 사용자 불만은 **미확인** |
| 승인과 매입이 따로 들어오며 생기는 중복·금액 차이 | 토스뱅크·뱅크샐러드 공식, Monarch 1mpztv8 |
| 날짜 경계: 출발·귀국 시각, 한국시간 기준 | 우리카드 공식, 트라비포켓 리뷰, Monzo |
| 귀국 후 청구: 미니바, 벌금, 기내면세, 보증금 정산 | KB 공식, r/personalfinance 760점 |
| 환불·부분취소가 기간 밖에 찍히거나 연동에서 빠짐 | 뱅크샐러드 769, Copilot 공식 |
| 일행 정산금 상계(늦게 들어옴, 내 몫과 전체 구분) | 트라비포켓 리뷰, Monarch 1urxuc4·1sarf1n, 뱅크샐러드 66 |
| 여행끼리 기간 겹침 | 1l34j3y, 1pzx6dx |
| 기간 밖이지만 여행 관련 지출(반려견 맡김 등) | 18w259i |
| 충전식 카드의 충전·사용·환불 시점 차이 | 클리앙 18259174, 하나카드 상품설명서 |
| 데이트: 통장 밖 결제, 기념일 포함 여부, 결제자와 부담자가 다름 | 데이트 섹션 참고 |

**묶음에서 보고 싶어 하는 숫자**

| 숫자 | 근거 |
|-|-|
| 총액 (가장 많음) | 10xwuvf, 1pzx6dx, 위플 리뷰 |
| 묶음 안의 카테고리별 금액 | 1tqbige, 위플Pro 리뷰, Actual #4806 |
| 1일 평균, 남은 하루 예산 | Tripcoin·트라비포켓 리뷰, Toshl, TravelSpend |
| 예산 대비 | 1on0e4o, 트라비포켓 |
| 1인당, 내 몫과 전체 | "1인 1일 평균 41,000원"(https://blog.naver.com/ssso12-/223351607595), TravelSpend 리뷰, 트라비포켓 리뷰 |
| 여행 빼고 본 평소 지출 | Simplifi 댓글, 국내 결산 블로그들 |
| 같은 여행의 연도별·여행 간 비교 | r/ynab 1r86wze, 클리앙 8098102 |
| 준비비용과 현지비용 분리 | 트라비포켓 리뷰 |

**미확인 항목**
- 날짜 범위 자동 태그를 직접 요청한 글
- 여행 중 구독료나 월세가 섞여서 불편했다는 사용자 글
- 토스 정산하기나 카카오페이 정산으로 받은 돈이 가계부에서 어떻게 분류되는지
- Google Play 리뷰 (정적 페이지에 몇 건만 보여서 거르지 못했습니다)
- 뽐뿌, 더쿠, 월급쟁이부자들, 네이버 카페 (로그인이 필요하거나 열어보지 못했습니다)
- Copilot 로드맵 (현재 "Workspace not found"로 열리지 않습니다)
- 개발사의 App Store 리뷰 답변 (리뷰 RSS에 답변이 포함되지 않습니다)

2025~26년 SEO·홍보성으로 보이는 블로그는 근거에서 뺐습니다. 해외 쪽 약 16곳(dynamiclabs, tripsense 등)과 국내 쪽 여행앱 홍보 후기, 'TOP 3' 같은 커플 통장 추천글 등입니다. 2026년 글 중에는 금액이 실제로 적힌 개인 월결산 연재 1건(https://blog.naver.com/planbflow/224471467503)만 남겼습니다.
