import { test } from '@playwright/test'
import {
  addCardAccount,
  createFirstBankAccount,
  enterTransaction,
  expectHomeBalances,
  logIn,
  logOut,
  newUser,
  signUp,
} from './support/ledger'

/*
 * 1A 핵심 흐름(docs/qa/test-strategy.md 3절)을 실제 서버(server jar와 PostgreSQL)에 붙여 돌린다. 테스트마다 새 이메일로 가입한다.
 * 기대값은 손으로 계산한 값이다. 계좌 잔액 = 시작 잔액 + 기준일(포함)부터의 거래(P-206). 수입은 더하고 지출은 빼며,
 * 이체는 보내는 계좌에서 빼고 받는 계좌에 더한다(F-203). 카드는 부채 계좌라 지출하면 음수가 된다(P-207).
 *
 * 날짜: 계좌의 기준일과 거래의 날짜는 모두 처음 값(기기의 오늘)을 둔다. 거래는 계좌를 만든 뒤에 넣으므로 자정을 넘겨도
 * 거래 날짜가 기준일보다 앞서지 않아 잔액이 같다. 월말에도 잔액은 달과 상관이 없다.
 *
 * 아직 넣지 않은 것: 홈의 이번 달 합계(C-01 (2))와 내역(D-01)은 거래 목록 API(#15)가 생긴 뒤에 더한다. 그때 브라우저 시계를
 * 고정해 "이번 달" 경계에 걸리지 않게 한다. 그 전에는 홈의 이번 달 합계와 최근 거래 구역이 "불러오지 못했어요."로 보인다.
 */

test('흐름 1: 가입하고 첫 계좌를 만든 뒤 지출을 넣으면 홈의 계좌 잔액이 그만큼 준다', async ({ page, isMobile }) => {
  await signUp(page, newUser())
  await createFirstBankAccount(page, '월급 통장', '1,000,000')
  await expectHomeBalances(page, [['은행', '1,000,000원']], '1,000,000원')

  await enterTransaction(page, isMobile, { type: '지출', amount: '12,300', account: '월급 통장' })
  // 1,000,000 - 12,300 = 987,700
  await expectHomeBalances(page, [['은행', '987,700원']], '987,700원')
})

test('흐름 1·4: 카드 지출은 카드 잔액을 음수로 만들고, 수입은 잔액을 늘리고, 이체는 두 계좌 사이로만 옮긴다', async ({
  page,
  isMobile,
}) => {
  await signUp(page, newUser())
  await createFirstBankAccount(page, '월급 통장', '1,000,000')
  // 지금 갚을 금액 0원으로 만든 카드의 잔액은 0원이다(F-502)
  await addCardAccount(page, '생활 카드')
  await expectHomeBalances(page, [['은행', '1,000,000원'], ['카드', '0원']], '1,000,000원')

  await enterTransaction(page, isMobile, { type: '지출', amount: '5,000', account: '생활 카드' })
  // 카드 0 - 5,000 = -5,000(갚을 금액이 5,000원). 자산 합계는 카드의 음수를 넣어 1,000,000 - 5,000 = 995,000(F-112)
  await expectHomeBalances(page, [['은행', '1,000,000원'], ['카드', '-5,000원']], '995,000원')

  await enterTransaction(page, isMobile, { type: '수입', amount: '50,000', account: '월급 통장' })
  // 은행 1,000,000 + 50,000 = 1,050,000. 자산 합계 1,050,000 - 5,000 = 1,045,000
  await expectHomeBalances(page, [['은행', '1,050,000원'], ['카드', '-5,000원']], '1,045,000원')

  // 카드대금 납부는 은행 계좌에서 카드 계좌로의 이체다(P-207, D-04 (19))
  await enterTransaction(page, isMobile, { type: '이체', amount: '5,000', from: '월급 통장', to: '생활 카드' })
  // 은행 1,050,000 - 5,000 = 1,045,000, 카드 -5,000 + 5,000 = 0. 두 계좌 사이로 옮겼을 뿐이라 자산 합계는 1,045,000 그대로다
  await expectHomeBalances(page, [['은행', '1,045,000원'], ['카드', '0원']], '1,045,000원')
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
