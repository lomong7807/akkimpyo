import { test } from '@playwright/test'
import { fixBrowserClock } from './support/clock'
import {
  addCardAccount,
  changeAmount,
  createFirstBankAccount,
  deleteTransaction,
  enterTransaction,
  expectEmptyHistoryMonth,
  expectHistoryMonth,
  expectHomeBalances,
  expectMonthTotals,
  logIn,
  logOut,
  moveHistoryToPreviousMonth,
  newUser,
  openHistory,
  openRecentTransaction,
  pressBack,
  signUp,
  undoDelete,
} from './support/ledger'

/*
 * 1A 핵심 흐름(docs/qa/test-strategy.md 3절)을 실제 서버(server jar와 PostgreSQL)에 붙여 돌린다. 테스트마다 새 이메일로 가입한다.
 * 기대값은 손으로 계산한 값이다. 계좌 잔액 = 시작 잔액 + 기준일(포함)부터의 거래(P-206). 수입은 더하고 지출은 빼며,
 * 이체는 보내는 계좌에서 빼고 받는 계좌에 더한다(F-203). 카드는 부채 계좌라 지출하면 음수가 된다(P-207).
 * 이번 달 합계는 그 달의 수입과 지출이고 이체, 취소, 삭제를 뺀다(P-205). 차액은 수입 - 지출이다(F-111).
 *
 * 날짜: 이번 달 합계와 내역을 보는 흐름은 브라우저 시계를 실행한 날(서울)의 12:00으로 고정한다(support/clock.ts).
 * 계좌의 기준일과 거래의 날짜, 시각은 처음 값(기기의 오늘, 지금 시각 12:00)을 둔다. 거래는 계좌를 만든 뒤에 넣고 날짜가
 * 같으므로 기준일보다 앞서지 않는다. 월말이나 자정에 돌려도 브라우저의 날은 그대로라 결과가 같다.
 *
 * 값이 그대로인 것을 볼 때는 다시 받기 전의 값으로도 통과하므로, 이어서 바뀐 값을 본다. 바뀐 값은 앞 단계까지 모두 반영한
 * 서버의 응답에서만 나온다.
 */

test('흐름 1: 가입하고 첫 계좌를 만든 뒤 지출을 넣으면 홈의 계좌 잔액과 이번 달 합계에 들고, 내역의 그날 묶음에 보인다', async ({
  page,
  isMobile,
}) => {
  const day = await fixBrowserClock(page)
  await signUp(page, newUser())
  await createFirstBankAccount(page, '월급 통장', '1,000,000')
  await expectHomeBalances(page, [['은행', '1,000,000원']], '1,000,000원')

  await enterTransaction(page, isMobile, { type: '지출', amount: '12,300', account: '월급 통장' })
  // 1,000,000 - 12,300 = 987,700
  await expectHomeBalances(page, [['은행', '987,700원']], '987,700원')
  // 이번 달 지출 12,300, 수입 0, 차액 0 - 12,300 = -12,300
  await expectMonthTotals(page, day.monthName, { expense: '12,300원', income: '0원', difference: '-12,300원' })

  // 내역(D-01)의 이번 달: 합계는 수입 0원, 지출 12,300원. 오늘 묶음 머리의 그날 합계는 지출만 있어 지출 12,300원이다.
  // 줄의 제목은 가맹점이 비어 카테고리 이름 "미분류"이고, 둘째 줄은 "카테고리 · 계좌"다(0.4). 시각은 고정한 12:00이다
  await openHistory(page, day.month, day.monthName)
  await expectHistoryMonth(page, { income: '0원', expense: '12,300원' }, [
    {
      dayName: day.dayName,
      sums: [['지출', '12,300원']],
      rows: [`미분류 12,300원 ${day.dayName} 12:00 미분류 · 월급 통장`],
    },
  ])

  // 지난달에는 그 거래가 없다. 내역은 주소의 달만 받는다(D-01 (1), 데이터 없음)
  await moveHistoryToPreviousMonth(page, day.previousMonth, day.previousMonthName)
  await expectEmptyHistoryMonth(page, day.previousMonthName)
})

test('흐름 1·4: 카드 지출은 카드 잔액을 음수로 만들고, 이체는 두 계좌 사이로만 옮기며 수입·지출 합계에 들지 않고, 수입은 잔액과 합계를 늘린다', async ({
  page,
  isMobile,
}) => {
  const day = await fixBrowserClock(page)
  await signUp(page, newUser())
  await createFirstBankAccount(page, '월급 통장', '1,000,000')
  // 지금 갚을 금액 0원으로 만든 카드의 잔액은 0원이다(F-502)
  await addCardAccount(page, '생활 카드')
  await expectHomeBalances(page, [['은행', '1,000,000원'], ['카드', '0원']], '1,000,000원')

  await enterTransaction(page, isMobile, { type: '지출', amount: '5,000', account: '생활 카드' })
  // 카드 0 - 5,000 = -5,000(갚을 금액이 5,000원). 자산 합계는 카드의 음수를 넣어 1,000,000 - 5,000 = 995,000(F-112)
  await expectHomeBalances(page, [['은행', '1,000,000원'], ['카드', '-5,000원']], '995,000원')
  // 이번 달 지출 5,000, 수입 0, 차액 0 - 5,000 = -5,000
  await expectMonthTotals(page, day.monthName, { expense: '5,000원', income: '0원', difference: '-5,000원' })

  // 카드대금 납부는 은행 계좌에서 카드 계좌로의 이체다(P-207, D-04 (19))
  await enterTransaction(page, isMobile, { type: '이체', amount: '5,000', from: '월급 통장', to: '생활 카드' })
  // 은행 1,000,000 - 5,000 = 995,000, 카드 -5,000 + 5,000 = 0. 두 계좌 사이로 옮겼을 뿐이라 자산 합계는 995,000 그대로다
  await expectHomeBalances(page, [['은행', '995,000원'], ['카드', '0원']], '995,000원')

  await enterTransaction(page, isMobile, { type: '수입', amount: '50,000', account: '월급 통장' })
  // 은행 995,000 + 50,000 = 1,045,000. 자산 합계 1,045,000 + 0 = 1,045,000
  await expectHomeBalances(page, [['은행', '1,045,000원'], ['카드', '0원']], '1,045,000원')
  // 이번 달 지출 5,000(카드 지출), 수입 50,000, 차액 50,000 - 5,000 = +45,000. 앞서 넣은 이체 5,000은 들지 않는다(F-203).
  // 이체가 지출로 들면 지출 10,000원, 수입으로 들면 수입 +55,000원이다. 수입 +50,000원은 이체 뒤에 넣은 수입까지 반영한 응답이다
  await expectMonthTotals(page, day.monthName, { expense: '5,000원', income: '+50,000원', difference: '+45,000원' })
})

test('흐름 2: 로그아웃하고 다시 로그인하면 같은 잔액이 보이고, 새로 고쳐도 로그인이 남는다', async ({ page, isMobile }) => {
  const user = newUser()
  await signUp(page, user)
  await createFirstBankAccount(page, '월급 통장', '1,000,000')
  await enterTransaction(page, isMobile, { type: '지출', amount: '12,300', account: '월급 통장' })
  await expectHomeBalances(page, [['은행', '987,700원']], '987,700원')

  await logOut(page, isMobile)
  await logIn(page, user)
  await expectHomeBalances(page, [['은행', '987,700원']], '987,700원')

  // access token은 메모리에만 둔다(ADR 001 결정 1). 새로 고치면 refresh 쿠키로 다시 받아 로그인한 채 홈을 연다
  await page.reload()
  await expectHomeBalances(page, [['은행', '987,700원']], '987,700원')
})

test('흐름 3: 거래를 고치면 홈의 합계와 잔액이 바뀌고, 지우면 거래 전으로, 되돌리면 고친 값으로 돌아온다', async ({
  page,
  isMobile,
}) => {
  const day = await fixBrowserClock(page)
  await signUp(page, newUser())
  await createFirstBankAccount(page, '월급 통장', '1,000,000')
  await enterTransaction(page, isMobile, { type: '지출', amount: '12,300', account: '월급 통장' })
  // 1,000,000 - 12,300 = 987,700. 이번 달 지출 12,300, 차액 -12,300
  await expectHomeBalances(page, [['은행', '987,700원']], '987,700원')
  await expectMonthTotals(page, day.monthName, { expense: '12,300원', income: '0원', difference: '-12,300원' })

  // 홈의 최근 거래 줄로 상세(D-06)를 열어 금액을 12,300 → 15,000으로 고친다. 상세에서 "뒤로"면 홈이다
  await openRecentTransaction(page, `미분류 12,300원 ${day.dayName} 12:00 미분류 · 월급 통장`)
  await changeAmount(page, '12,300', '15,000')
  await pressBack(page)
  // 1,000,000 - 15,000 = 985,000. 이번 달 지출 15,000, 차액 -15,000
  await expectHomeBalances(page, [['은행', '985,000원']], '985,000원')
  await expectMonthTotals(page, day.monthName, { expense: '15,000원', income: '0원', difference: '-15,000원' })

  // 지우면 이전 화면(홈)으로 돌아간다(D-06 (21)). 휴지통의 거래는 잔액과 합계에서 빠져 거래 전 값이다(P-205)
  await openRecentTransaction(page, `미분류 15,000원 ${day.dayName} 12:00 미분류 · 월급 통장`)
  await deleteTransaction(page)
  await expectHomeBalances(page, [['은행', '1,000,000원']], '1,000,000원')
  await expectMonthTotals(page, day.monthName, { expense: '0원', income: '0원', difference: '0원' })

  // 삭제 직후 토스트의 "되돌리기"로 복원하면 고친 값(15,000)으로 돌아온다(F-230)
  await undoDelete(page)
  await expectHomeBalances(page, [['은행', '985,000원']], '985,000원')
  await expectMonthTotals(page, day.monthName, { expense: '15,000원', income: '0원', difference: '-15,000원' })
})
