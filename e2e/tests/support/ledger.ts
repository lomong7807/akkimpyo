import { randomBytes } from 'node:crypto'
import { expect, type Locator, type Page } from '@playwright/test'

/*
 * 핵심 흐름(docs/qa/test-strategy.md 3절)이 함께 쓰는 사용자 동작. 화면설계서의 근거 위치를 동작마다 적는다.
 * 넓은 화면(chromium, 1280px)과 휴대폰 배치(webkit-iphone, 402px)는 공통 틀이 다르다(00-common 6.2).
 * 두 프로젝트를 Playwright의 isMobile로 가른다. 휴대폰 배치를 정하는 것은 폭(1024px 미만)이다.
 */

export interface TestUser {
  email: string
  password: string
  displayName: string
}

/**
 * 테스트마다 새 사용자(test-strategy.md 4절). 도메인은 서버의 가입 허용 목록(playwright.config.ts의 SIGNUP_ALLOWLIST)에 든다.
 * 비밀번호는 P-101(8~72자, 영문과 숫자를 함께)에 맞춘 실행마다 다른 값이다.
 */
export function newUser(): TestUser {
  const id = randomBytes(6).toString('hex')
  return { email: `e2e-${id}@example.com`, password: `pw${id}9`, displayName: '흐름 확인' }
}

/** 토스트(ToastProvider의 role="status" 영역)에 그 문구가 보인다 */
export function toast(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: text })
}

/** 하단 탭(휴대폰)이나 사이드바(넓은 화면)의 주 메뉴. 한 화면에 하나만 보인다(00-common 6.2) */
function mainMenu(page: Page): Locator {
  return page.getByRole('navigation', { name: '주 메뉴' })
}

/** A-03 가입. 가입하면 계좌가 없으므로 첫 실행 안내(C-02) 첫 장이 열린다(F-118) */
export async function signUp(page: Page, user: TestUser) {
  await page.goto('/signup')
  await page.getByRole('textbox', { name: '이메일', exact: true }).fill(user.email)
  await page.getByRole('textbox', { name: '비밀번호', exact: true }).fill(user.password)
  await page.getByRole('textbox', { name: '비밀번호 확인', exact: true }).fill(user.password)
  await page.getByRole('textbox', { name: '표시 이름', exact: true }).fill(user.displayName)
  await page.getByRole('button', { name: '가입', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1, name: '기본 카테고리를 넣어 두었어요' })).toBeVisible()
  await expect(page).toHaveURL('/welcome')
}

/**
 * C-02 첫 실행 안내를 마친다. 첫 장 (6) "다음", 둘째 장 (8) 계좌 이름, (9) 종류(처음부터 은행), (10) 시작 잔액,
 * (12) "계좌 만들기". 기준일 (11)은 처음 값(기기의 오늘)을 둔다. 만들면 홈으로 가고 토스트 "계좌를 만들었어요"다.
 */
export async function createFirstBankAccount(page: Page, name: string, openingBalance: string) {
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '첫 계좌를 만들어 주세요' })).toBeVisible()

  await page.getByRole('textbox', { name: '계좌 이름', exact: true }).fill(name)
  await expect(page.getByRole('radio', { name: '은행', exact: true })).toBeChecked()
  const amount = page.getByRole('textbox', { name: '시작 잔액' })
  await amount.fill(digitsOf(openingBalance))
  // 적는 동안 세 자리마다 쉼표를 넣는다(C-02 (10))
  await expect(amount).toHaveValue(openingBalance)
  await page.getByRole('button', { name: '계좌 만들기', exact: true }).click()

  await expect(toast(page, '계좌를 만들었어요')).toBeVisible()
  await expect(page).toHaveURL('/home')
}

/**
 * G-02 계좌 추가로 카드 계좌를 만든다. 홈의 계좌 잔액 요약(C-01 (5))을 누르면 계좌 목록(G-01)이고, 상단 바의 "추가"가 G-02다.
 * 카드는 시작 잔액 대신 "지금 갚을 금액"(양수로 받아 음수로 저장, F-502)이고 처음 값 0을 둔다.
 * 저장하면 계좌 목록으로 돌아가고 토스트 "'{이름}' 계좌를 추가했어요"다. 홈으로 돌아와 끝낸다.
 */
export async function addCardAccount(page: Page, name: string) {
  await homeBalances(page).click()
  await expect(page).toHaveURL('/accounts')
  await page.getByRole('link', { name: '추가', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '계좌 추가' })).toBeVisible()

  await page.getByRole('textbox', { name: '이름', exact: true }).fill(name)
  await page.getByRole('radio', { name: '카드', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '지금 갚을 금액' })).toHaveValue('0')
  await page.getByRole('button', { name: '저장', exact: true }).click()

  await expect(toast(page, `'${name}' 계좌를 추가했어요`)).toBeVisible()
  await expect(page).toHaveURL('/accounts')
  await mainMenu(page).getByRole('link', { name: '홈', exact: true }).click()
  await expect(page).toHaveURL('/home')
}

export type NewTransaction =
  | { type: '지출'; amount: string; account: string }
  | { type: '수입'; amount: string; account: string }
  | { type: '이체'; amount: string; from: string; to: string }

/**
 * 빠른 입력(B-03)으로 D-04 거래 입력을 열어 저장한다. 휴대폰은 하단 탭 가운데 칸, 넓은 화면은 사이드바 맨 위의 "거래 입력"이다.
 * 유형 (1), 금액 (3), 계좌 (6)·(17)·(18)을 고르고 날짜는 처음 값(기기의 오늘), 카테고리는 처음 값(미분류)을 둔다.
 * 저장하면 토스트 "저장했어요"(F-201)이고 연 화면(홈)으로 돌아간다.
 */
export async function enterTransaction(page: Page, isMobile: boolean, transaction: NewTransaction) {
  await quickEntry(page, isMobile).click()
  await expect(page.getByRole('heading', { level: 1, name: '거래 입력' })).toBeVisible()

  // 빠른 입력은 지출 유형으로 연다(B-03, D-04)
  const type = page.getByRole('radio', { name: transaction.type, exact: true })
  if (transaction.type !== '지출') await type.click()
  await expect(type).toBeChecked()
  const amount = page.getByRole('textbox', { name: '금액' })
  await amount.fill(digitsOf(transaction.amount))
  await expect(amount).toHaveValue(transaction.amount)
  if (transaction.type === '이체') {
    await pickAccount(page, '보내는 계좌', transaction.from)
    await pickAccount(page, '받는 계좌', transaction.to)
  } else {
    // 계좌 칸의 이름: 지출 "계좌", 수입 "들어온 계좌"(D-04 (6))
    await pickAccount(page, transaction.type === '지출' ? '계좌' : '들어온 계좌', transaction.account)
  }
  await page.getByRole('button', { name: '저장', exact: true }).click()

  await expect(toast(page, '저장했어요')).toBeVisible()
  await expect(page).toHaveURL('/home')
}

/**
 * 빠른 입력 버튼. 휴대폰은 하단 탭(주 메뉴) 안의 칸이다. 넓은 화면은 사이드바의 장부 이름 아래 버튼인데 주 메뉴(nav) 밖이고
 * 사이드바에 랜드마크가 없어 role로 범위를 좁힐 수 없다. 홈에 거래가 없으면 내용 영역의 빈 상태(C-01 데이터 없음)에도 같은 이름의
 * 링크가 있으므로, 문서 순서로 내용 영역보다 앞에 있는 사이드바의 것을 고른다.
 */
function quickEntry(page: Page, isMobile: boolean): Locator {
  if (isMobile) return mainMenu(page).getByRole('link', { name: '거래 입력', exact: true })
  return page.getByRole('link', { name: '거래 입력', exact: true }).first()
}

/** 고르는 칸(00-common 5.2)을 눌러 판을 열고 계좌를 고른다. 칸의 이름은 칸 이름 뒤에 고른 계좌 이름이다 */
async function pickAccount(page: Page, label: string, account: string) {
  await page.getByRole('button', { name: new RegExp(`^${label}( |$)`) }).click()
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: account, exact: true }).click()
  await expect(page.getByRole('button', { name: `${label} ${account}`, exact: true })).toBeVisible()
}

/** 홈의 계좌 잔액 요약(C-01 (5)). 구역 전체가 계좌 목록으로 가는 링크 하나이고 이름에 자산 합계가 든다 */
function homeBalances(page: Page): Locator {
  return page.getByRole('link', { name: /^계좌 잔액, 자산 합계 / })
}

/**
 * 홈의 계좌 잔액 요약(C-01 (5), F-112)이 보이는 값. 종류별 합계 줄(은행, 카드, 현금 순서, 계좌가 없는 종류는 숨김)과
 * 구분선 아래 자산 합계(카드의 음수 포함). 금액은 "987,700원", 음수는 "-5,000원"이다.
 */
export async function expectHomeBalances(page: Page, byType: [string, string][], total: string) {
  await expect(page).toHaveURL('/home')
  const summary = homeBalances(page)
  await expect(summary).toHaveAccessibleName(`계좌 잔액, 자산 합계 ${total}`)
  await expect(summary.getByRole('term')).toHaveText([...byType.map(([type]) => type), '자산 합계'])
  await expect(summary.getByRole('definition')).toHaveText([...byType.map(([, amount]) => amount), total])
}

/** 홈의 이번 달 합계(C-01 (2))가 보이는 값. 화면에 보이는 글자 그대로("12,300원", "+50,000원", "-12,300원")다 */
export interface MonthTotals {
  expense: string
  income: string
  /** 수입 - 지출. 0이 아니면 부호를 늘 붙인다(01 작성자 판단 37) */
  difference: string
}

/**
 * 홈의 이번 달 합계(C-01 (2), F-111). 머리 줄 "{달} 합계" 구역에 지출(큰 숫자), 수입, 차액 순서다. 수입이 0원이면 부호 없이
 * "0원"이다(02 0.2). 계산은 P-205(이체, 취소, 삭제를 뺀다). 큰 지출 숫자는 폭에 따라 고르는 두 벌이고 작은 짝은 화면 읽기에
 * 숨기므로(aria-hidden), 화면 읽기에 보이는 것(aria snapshot)으로 본다.
 */
export async function expectMonthTotals(page: Page, monthName: string, { expense, income, difference }: MonthTotals) {
  await expect(page).toHaveURL('/home')
  await expect(page.getByRole('region', { name: `${monthName} 합계`, exact: true })).toMatchAriaSnapshot(
    lines([
      '- term: "지출"',
      `- definition: ${quoted(expense)}`,
      '- term: "수입"',
      `- definition: ${quoted(income)}`,
      '- term: "차액"',
      `- definition: ${quoted(difference)}`,
    ]),
  )
}

/**
 * 주 메뉴의 "내역"으로 내역(D-01)을 연다. 처음 열면 이번 달(기기의 오늘이 속한 달)이고 주소에 그 달을 담는다(D-01 (1)).
 * 달 이름은 달 이동 가운데의 화면 제목(h1)이다(00-common 5.9).
 */
export async function openHistory(page: Page, month: string, monthName: string) {
  await mainMenu(page).getByRole('link', { name: '내역', exact: true }).click()
  await expectHistoryAt(page, month, monthName)
}

/** 내역(D-01)의 달 이동 "이전 달"로 지난달을 연다(00-common 5.9). 주소의 달이 바뀐다 */
export async function moveHistoryToPreviousMonth(page: Page, month: string, monthName: string) {
  await page.getByRole('button', { name: '이전 달', exact: true }).click()
  await expectHistoryAt(page, month, monthName)
}

async function expectHistoryAt(page: Page, month: string, monthName: string) {
  await expect(page).toHaveURL(`/transactions?month=${month}`)
  await expect(page.getByRole('heading', { level: 1, name: monthName, exact: true })).toBeVisible()
}

/** 내역의 날짜 묶음 하나(D-01 (7)·(8)) */
export interface HistoryDay {
  /** 날짜 묶음 머리의 날짜 "11월 27일 (금)"(02 0.3) */
  dayName: string
  /** 그날 합계 [이름, 금액]. 지출만 있으면 지출만이다(02 0.5) */
  sums: [string, string][]
  /** 거래 줄 링크의 이름. 제목, 금액, 날짜, 시각, 둘째 줄("카테고리 · 계좌")을 띄어 잇는다(02 0.4) */
  rows: string[]
}

/**
 * 내역(D-01)에 보이는 그 달: 수입·지출 합계 (4), 날짜 묶음 머리와 그날 합계 (7), 그 날짜를 이름으로 하는 목록 안의 거래 줄 (8).
 * 목록에는 적은 줄만 있다. 화면 읽기에 보이는 차례(aria snapshot)로 본다.
 */
export async function expectHistoryMonth(page: Page, totals: { income: string; expense: string }, days: HistoryDay[]) {
  const dayLines = days.flatMap(({ dayName, sums, rows }) => [
    `- heading ${quoted(dayName)} [level=2]`,
    ...sums.flatMap(([name, amount]) => [`- term: ${quoted(name)}`, `- definition: ${quoted(amount)}`]),
    `- list ${quoted(dayName)}:`,
    '  - /children: equal',
    ...rows.flatMap((row) => ['  - listitem:', `    - link ${quoted(row)}`]),
  ])
  await expect(page.getByRole('main')).toMatchAriaSnapshot(
    lines([
      '- term: "수입"',
      `- definition: ${quoted(totals.income)}`,
      '- term: "지출"',
      `- definition: ${quoted(totals.expense)}`,
      ...dayLines,
    ]),
  )
}

/** 그 달에 거래가 없다(D-01 데이터 없음): 합계는 둘 다 0원이고 목록 자리에 "{달}에 입력한 거래가 없어요"다 */
export async function expectEmptyHistoryMonth(page: Page, monthName: string) {
  await expect(page.getByRole('main')).toMatchAriaSnapshot(
    lines(['- term: "수입"', '- definition: "0원"', '- term: "지출"', '- definition: "0원"']),
  )
  await expect(page.getByText(`${monthName}에 입력한 거래가 없어요`, { exact: true })).toBeVisible()
}

/** 홈의 최근 거래(C-01 (8))에서 그 줄을 눌러 거래 상세(D-06)를 연다. 줄 링크의 이름은 내역의 거래 줄과 같다(02 0.4) */
export async function openRecentTransaction(page: Page, row: string) {
  await page.getByRole('region', { name: '최근 거래', exact: true }).getByRole('link', { name: row, exact: true }).click()
  await expectTransactionDetail(page)
}

async function expectTransactionDetail(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: '거래 상세' })).toBeVisible()
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/)
}

/**
 * 거래 상세(D-06)의 "수정"(1)으로 거래 수정(D-04)을 열어 금액만 바꿔 저장한다(F-208). 칸은 받은 거래의 값으로 채워진다.
 * 채워지기 전에 치면 채울 때 덮이므로 원래 금액이 보인 뒤에 친다. 저장하면 토스트 "저장했어요"이고 앞 화면(상세)으로 돌아가며,
 * 상세의 금액(2)이 바꾼 값이다.
 */
export async function changeAmount(page: Page, from: string, to: string) {
  await page.getByRole('link', { name: '수정', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '거래 수정' })).toBeVisible()
  const amount = page.getByRole('textbox', { name: '금액' })
  await expect(amount).toHaveValue(from)
  await amount.fill(digitsOf(to))
  await expect(amount).toHaveValue(to)
  await page.getByRole('button', { name: '저장', exact: true }).click()

  await expect(toast(page, '저장했어요')).toBeVisible()
  await expectTransactionDetail(page)
  await expect(page.getByRole('main').getByText(`${to}원`, { exact: true })).toBeVisible()
}

/** 하위 화면 상단 바의 "뒤로"로 앞 화면으로 돌아간다(00-common 6.1) */
export async function pressBack(page: Page) {
  await page.getByRole('button', { name: '뒤로', exact: true }).click()
}

/**
 * 거래 상세(D-06)의 "삭제"(21)로 확인 창 "이 거래를 삭제할까요?"를 열고 "삭제"한다(F-227). 성공하면 이전 화면으로 돌아가고
 * 토스트 "휴지통으로 옮겼어요"와 "되돌리기"다. 되돌리기가 있는 토스트는 8초 동안 보인다(00-common 5.7).
 */
export async function deleteTransaction(page: Page) {
  await page.getByRole('button', { name: '삭제', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '이 거래를 삭제할까요?' })
  await dialog.getByRole('button', { name: '삭제', exact: true }).click()

  await expect(dialog).toBeHidden()
  await expect(undoButton(page)).toBeVisible()
}

/** 삭제 직후 토스트의 "되돌리기"로 복원한다(F-230). 성공하면 토스트 "되돌렸어요"다(00-common 5.7) */
export async function undoDelete(page: Page) {
  await undoButton(page).click()
  await expect(toast(page, '되돌렸어요')).toBeVisible()
}

function undoButton(page: Page): Locator {
  return toast(page, '휴지통으로 옮겼어요').getByRole('button', { name: '되돌리기', exact: true })
}

/** aria snapshot 틀의 글. JSON 문자열은 YAML의 큰따옴표 문자열이기도 하다 */
function quoted(text: string): string {
  return JSON.stringify(text)
}

function lines(template: string[]): string {
  return template.join('\n')
}

/**
 * 로그아웃한다. 휴대폰은 하단 탭의 더보기(M-01) 맨 아래, 넓은 화면은 사이드바 맨 아래의 "로그아웃"이다(1A 임시 자리).
 * 이 기기에 보내지 않은 입력이 없으므로 확인 없이 로그인(A-02)으로 간다(F-016. 있을 때만 "로그아웃할까요?"를 묻는다).
 */
export async function logOut(page: Page, isMobile: boolean) {
  if (isMobile) {
    await mainMenu(page).getByRole('link', { name: '더보기', exact: true }).click()
    await expect(page).toHaveURL('/more')
  }
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible()
  await expect(page).toHaveURL('/login')
}

/** A-02 로그인. 계좌가 있으므로 첫 실행 안내 없이 홈으로 간다(F-118) */
export async function logIn(page: Page, user: TestUser) {
  await page.getByRole('textbox', { name: '이메일', exact: true }).fill(user.email)
  await page.getByRole('textbox', { name: '비밀번호', exact: true }).fill(user.password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/home')
}

/** "1,000,000" → "1000000". 금액 칸에는 숫자만 친다 */
function digitsOf(amount: string): string {
  return amount.replace(/,/g, '')
}
