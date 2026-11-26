import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Accounts } from './support/accounts'
import { ledgerIdOf, type Backend } from './support/backend'
import { untilOpened, untilUnshielded } from './support/dialog'
import { setDeviceClock } from './support/clock'
import { startGuardClock } from './support/guardClock'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import {
  accountField,
  amount,
  categoryField,
  closeButton,
  dateField,
  discardQuestion,
  errorOf,
  heading,
  id,
  LAST_ACCOUNT_KEY,
  LEDGER,
  memo,
  moreButton,
  openApp,
  openForm,
  path,
  payee,
  pick,
  resetGlobals,
  saveAmount,
  saveButton,
  settle,
  startServer,
  time,
  typeRadio,
  type User,
} from './support/transactionScreen'
import type { Transactions } from './support/transactions'
import { resetViewport, setViewportWidth } from './support/viewport'

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let transactions: Transactions

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  startGuardClock()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, accounts, transactions } = startServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const sent = () => transactions.sent.at(-1)?.body
const options = () => within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)

async function openOptions(user: User, field: HTMLElement) {
  await user.click(field)
  await untilOpened()
  return options()
}

describe('여는 길', () => {
  it('/transactions/new는 "거래 입력" 전체 화면 입력이고 하단 탭이 없다', async () => {
    await openForm()
    expect(heading()).toBeTruthy()
    setViewportWidth(390)
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
  })

  it('넓은 화면에서는 사이드바가 그대로 있다', async () => {
    await openForm()
    setViewportWidth(1280)
    expect(screen.getByRole('navigation', { name: '주 메뉴', hidden: true })).toBeTruthy()
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 새 입력을 연다', async () => {
    backend.cookieUser = undefined
    const opened = await openApp('/transactions/new')
    await opened.user.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { level: 1, name: '거래 입력' })).toBeTruthy()
  })
})

describe('요소와 처음 값', () => {
  it('유형, 금액, 가맹점/내용, 카테고리, 계좌, 날짜, 더 보기, 저장이 위에서부터 놓인다', async () => {
    await openForm()
    const all = [...document.querySelectorAll('*')]
    const order = [screen.getByRole('radiogroup', { name: '유형' }), amount(), payee(), categoryField(), accountField(), dateField(), moreButton(), saveButton()]
    const positions = order.map((element) => all.indexOf(element))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })

  it('유형은 지출, 수입, 이체이고 처음에는 지출이다', async () => {
    await openForm()
    const radios = within(screen.getByRole('radiogroup', { name: '유형' })).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['지출', '수입', '이체'])
    expect(typeRadio('지출').getAttribute('aria-checked')).toBe('true')
  })

  it('금액은 비어 있고 열리면 초점을 받으며 숫자 키패드다', async () => {
    await openForm()
    expect(amount().value).toBe('')
    expect(amount().inputMode).toBe('numeric')
    expect(document.activeElement).toBe(amount())
  })

  it('금액의 값은 text-title, "원"은 그대로다', async () => {
    await openForm()
    expect(getComputedStyle(amount()).font).toBe('var(--text-title)')
    expect(amount().className).toContain('title')
  })

  it('가맹점/내용은 선택 칸이고 비어 있으며 흐린 예시가 있다', async () => {
    await openForm()
    expect(payee().value).toBe('')
    expect(payee().placeholder).toBe('예: 올래국수')
    expect(payee().getAttribute('enterkeyhint')).toBe('done')
  })

  it('카테고리는 비어 있어 "미분류"가 보인다', async () => {
    await openForm()
    expect(categoryField().textContent).toBe('미분류')
  })

  it('날짜는 기기의 오늘이다', async () => {
    await openForm()
    expect(dateField().textContent).toBe('11월 26일 (목)')
  })

  it('"더 보기"는 접혀 있고 시각과 메모가 보이지 않는다', async () => {
    await openForm()
    expect(moreButton().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox', { name: '시각 (선택)' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: '메모 (선택)' })).toBeNull()
  })

  it('여는 때 오류와 알림이 없다', async () => {
    await openForm()
    expect([amount(), payee(), accountField(), dateField()].map(errorOf)).toEqual([undefined, undefined, undefined, undefined])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('금액', () => {
  const outOfRange = '1원부터 9,999,999,999원까지 입력할 수 있어요'

  it.each([
    ['비었음', ''],
    ['0', '0'],
  ])('%s이면 저장하지 않고 문구를 보이며 초점을 옮긴다', async (_, typed) => {
    const { user } = await openForm()
    await saveAmount(user, typed)
    expect(errorOf(amount())).toBe(outOfRange)
    expect(document.activeElement).toBe(amount())
    expect(transactions.sent).toEqual([])
  })

  it('쓰다가 비우고 칸을 벗어나면 검사한다', async () => {
    const { user } = await openForm()
    await user.keyboard('5{Backspace}')
    await user.click(payee())
    expect(errorOf(amount())).toBe(outOfRange)
  })

  it('열릴 때 받은 초점에서 한 번도 쓰지 않고 다른 칸으로 가면 오류를 띄우지 않는다. 저장할 때 검사한다', async () => {
    const { user } = await openForm()
    await user.click(payee())
    expect(errorOf(amount())).toBeUndefined()
    await user.click(saveButton())
    expect(errorOf(amount())).toBe(outOfRange)
  })

  it('11번째 숫자는 들어가지 않는다', async () => {
    const { user } = await openForm()
    await user.keyboard('99999999999')
    expect(amount().value).toBe('9,999,999,999')
  })

  it('엔터(물리 키보드)는 가맹점/내용으로 간다', async () => {
    const { user } = await openForm()
    await user.keyboard('12000{Enter}')
    expect(document.activeElement).toBe(payee())
    expect(transactions.sent).toEqual([])
  })
})

describe('가맹점/내용', () => {
  const count = () => screen.queryByText(/^\d+\/100$/)?.textContent

  it.each([
    ['101자', '가'.repeat(101), '100자까지 쓸 수 있어요'],
    ['보이지 않는 글자', '올래\u{200B}국수', '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
    // 서버는 앞뒤의 공백류(Zs)만 지우고 탭은 거부한다(#220)
    ['끝의 탭', '올래국수\t', '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
  ])('%s이면 칸을 벗어날 때 문구를 보이고 저장하지 않는다', async (_, typed, message) => {
    const { user } = await openForm()
    await user.click(payee())
    await user.paste(typed)
    await user.tab()
    expect(errorOf(payee())).toBe(message)
    await saveAmount(user)
    expect(transactions.sent).toEqual([])
  })

  it('80자를 넘으면 글자 수가 보인다', async () => {
    const { user } = await openForm()
    await user.click(payee())
    await user.paste('가'.repeat(80))
    expect(count()).toBeUndefined()
    await user.keyboard('나')
    expect(count()).toBe('81/100')
  })

  it('앞뒤 공백을 지운 조합형 글자로 센다', async () => {
    const { user } = await openForm()
    await user.click(payee())
    await user.paste(`  ${'가'.repeat(100).normalize('NFD')}\u{3000}`)
    await user.tab()
    expect(errorOf(payee())).toBeUndefined()
    expect(count()).toBe('100/100')
  })

  it('앞뒤 공백을 지우고 조합형으로 맞춰 보낸다', async () => {
    const { user } = await openForm()
    await user.click(payee())
    await user.paste(` ${'올래국수'.normalize('NFD')}\u{A0}`)
    await saveAmount(user)
    await waitFor(() => expect(sent()?.payee).toBe('올래국수'))
  })

  it.each([
    ['빈 글자', ''],
    ['공백류뿐', ' \u{3000}\u{A0}'],
  ])('%s이면 null로 보낸다', async (_, typed) => {
    const { user } = await openForm()
    if (typed) {
      await user.click(payee())
      await user.paste(typed)
    }
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ payee: null }))
  })

  it('엔터는 저장이다', async () => {
    const { user } = await openForm()
    await user.keyboard('12000')
    await user.click(payee())
    await user.keyboard('올래국수{Enter}')
    await waitFor(() => expect(sent()).toMatchObject({ amount: 12000, payee: '올래국수' }))
  })
})

describe('카테고리', () => {
  it('지출이면 지출 카테고리만 상위 아래 하위로 나오고 미분류는 맨 아래다', async () => {
    const { user } = await openForm()
    expect(await openOptions(user, categoryField())).toEqual(['식비', '외식', '장보기', '교통', '미분류'])
    expect(screen.getByRole('textbox', { name: '카테고리 이름 찾기' })).toBeTruthy()
  })

  it('수입이면 수입 카테고리만 나온다', async () => {
    const { user } = await openForm()
    await user.click(typeRadio('수입'))
    expect(await openOptions(user, categoryField())).toEqual(['급여', '상여', '미분류'])
  })

  it('비어 있으면 미분류 줄에 Check가 있고 판은 첫 줄에서 시작한다', async () => {
    const { user } = await openForm()
    await openOptions(user, categoryField())
    expect(screen.getByRole('option', { name: '미분류' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '식비' }))
  })

  it('고른 카테고리가 있으면 판은 그 줄에서 시작한다', async () => {
    const { user } = await openForm()
    await pick(user, categoryField(), '교통')
    await untilUnshielded()
    await openOptions(user, categoryField())
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '교통' }))
  })

  it.each([
    ['상위', '식비', id.food],
    ['하위', '외식', id.dining],
  ])('%s를 고르면 칸에 이름이 보이고 그 id로 보낸다', async (_, name, categoryId) => {
    const { user } = await openForm()
    await pick(user, categoryField(), name)
    expect(categoryField().textContent).toBe(name)
    await saveAmount(user)
    await waitFor(() => expect(sent()?.categoryId).toBe(categoryId))
  })

  it('비우면(미분류) null로 보내 서버가 미분류로 저장한다', async () => {
    const { user } = await openForm()
    await pick(user, categoryField(), '식비')
    await untilUnshielded()
    await pick(user, categoryField(), '미분류')
    expect(categoryField().textContent).toBe('미분류')
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ categoryId: null }))
  })

  it('지출과 수입 사이에서 바꾸면 카테고리만 비운다', async () => {
    const { user } = await openForm()
    await pick(user, categoryField(), '외식')
    await user.click(amount())
    await user.keyboard('5000')
    await user.click(payee())
    await user.paste('점심')
    await user.click(typeRadio('수입'))
    expect(categoryField().textContent).toBe('미분류')
    expect([amount().value, payee().value, accountField('들어온 계좌').textContent]).toEqual(['5,000', '점심', '급여통장'])
  })

  it('이체를 거쳐 같은 구분으로 돌아오면 카테고리가 남고, 다른 구분으로 가면 비운다', async () => {
    const { user } = await openForm()
    await pick(user, categoryField(), '교통')
    await user.click(typeRadio('이체'))
    await user.click(typeRadio('지출'))
    expect(categoryField().textContent).toBe('교통')
    await user.click(typeRadio('이체'))
    await user.click(typeRadio('수입'))
    expect(categoryField().textContent).toBe('미분류')
  })

  it('선택 항목이라 비어 있어도 오류가 없다', async () => {
    const { user } = await openForm()
    await user.click(saveButton())
    expect(errorOf(amount())).toBeTruthy()
    expect(errorOf(categoryField())).toBeUndefined()
  })
})

describe('계좌', () => {
  it('계좌 판에는 찾기 칸이 없고 열면 지금 값에 초점이 간다(0.8)', async () => {
    const { user } = await openForm()
    await pick(user, accountField(), '지갑')
    await untilUnshielded()
    await openOptions(user, accountField())
    expect(screen.queryByRole('textbox', { name: '계좌 이름 찾기' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('option', { name: '지갑' }))
  })

  it('은행, 카드, 현금 묶음에 이름만 나온다(잔액 없음)', async () => {
    const { user } = await openForm()
    await openOptions(user, accountField())
    const list = screen.getByRole('listbox', { name: '계좌' })
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-labelledby') && group.textContent)).toEqual([
      '은행급여통장비상금',
      '카드신한카드',
      '현금지갑',
    ])
    expect(document.body.textContent).not.toContain('1,500,000')
  })

  it('기록이 없으면 계좌 목록(G-01)의 첫 계좌다', async () => {
    await openForm()
    expect(accountField().textContent).toBe('급여통장')
  })

  it('기본 계좌로 보낸다', async () => {
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(sent()?.accountId).toBe(id.salary))
  })

  it('고른 계좌로 보낸다', async () => {
    const { user } = await openForm()
    await pick(user, accountField(), '지갑')
    expect(accountField().textContent).toBe('지갑')
    await saveAmount(user)
    await waitFor(() => expect(sent()?.accountId).toBe(id.wallet))
  })

  it('수입의 칸 이름은 "들어온 계좌"다', async () => {
    const { user } = await openForm()
    await user.click(typeRadio('수입'))
    expect(accountField('들어온 계좌')).toBeTruthy()
  })

  describe('마지막으로 쓴 계좌', () => {
    const store = (value: unknown) => localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(value))

    it('이 사용자가 이 장부에서 마지막으로 쓴 계좌가 기본값이다', async () => {
      store({ userId: 'user-1', ledgerId: LEDGER, accountId: id.wallet })
      await openForm()
      expect(accountField().textContent).toBe('지갑')
    })

    it.each([
      ['다른 사용자', { userId: 'user-2', ledgerId: LEDGER, accountId: id.wallet }],
      ['다른 장부', { userId: 'user-1', ledgerId: ledgerIdOf('user-2'), accountId: id.wallet }],
      ['UUID 모양이 아닌 계좌', { userId: 'user-1', ledgerId: LEDGER, accountId: '../me' }],
      ['목록에 없는 계좌', { userId: 'user-1', ledgerId: LEDGER, accountId: '55555555-5555-4555-8555-555555555555' }],
      ['사용자가 없는 값', { ledgerId: LEDGER, accountId: id.wallet }],
      ['객체가 아닌 값', id.wallet],
    ])('%s이면 쓰지 않고 첫 계좌다', async (_, value) => {
      store(value)
      await openForm()
      expect(accountField().textContent).toBe('급여통장')
    })

    it('읽을 수 없는 값이면 첫 계좌다', async () => {
      localStorage.setItem(LAST_ACCOUNT_KEY, '{')
      await openForm()
      expect(accountField().textContent).toBe('급여통장')
    })

    it('저장소를 쓸 수 없어도 조용히 첫 계좌로 열고 저장한다', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('막힘', 'SecurityError')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('가득 참', 'QuotaExceededError')
      })
      const { user } = await openForm()
      expect(accountField().textContent).toBe('급여통장')
      await saveAmount(user)
      await waitFor(() => expect(transactions.sent).toHaveLength(1))
      expect(await screen.findByText('저장했어요')).toBeTruthy()
    })

    it.each([
      ['지출의 계좌', async (user: User) => pick(user, accountField(), '비상금'), id.saving],
      [
        '이체의 보내는 계좌',
        async (user: User) => {
          await user.click(typeRadio('이체'))
          await pick(user, accountField('보내는 계좌'), '비상금')
          await untilUnshielded()
          await pick(user, accountField('받는 계좌'), '신한카드')
        },
        id.saving,
      ],
    ])('저장에 성공하면 %s를 적는다', async (_, choose, accountId) => {
      const { user } = await openForm()
      await choose(user)
      await saveAmount(user)
      await screen.findByText('저장했어요')
      expect(JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY)!)).toEqual({ userId: 'user-1', ledgerId: LEDGER, accountId })
    })

    it('실패하면 적지 않는다', async () => {
      transactions.response = () => problem(500, 'INTERNAL_ERROR')
      const { user } = await openForm()
      await pick(user, accountField(), '비상금')
      await saveAmount(user)
      await screen.findByRole('alert')
      expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull()
    })

    it('적은 계좌가 다음 입력의 기본값이고, 로그아웃해도 지우지 않는다', async () => {
      const { user } = await openForm()
      await pick(user, accountField(), '지갑')
      await saveAmount(user)
      await screen.findByText('저장했어요')
      await user.click(screen.getByRole('button', { name: '로그아웃', hidden: true }))
      await screen.findByRole('heading', { level: 1, name: '로그인' })
      expect(JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY)!).accountId).toBe(id.wallet)
      cleanup()
      backend.cookieUser = 'user-1'
      await openForm()
      expect(accountField().textContent).toBe('지갑')
    })

    it('다른 사용자로 열면 앞 사용자의 계좌를 쓰지 않는다', async () => {
      store({ userId: 'user-1', ledgerId: ledgerIdOf('user-2'), accountId: id.wallet })
      backend.cookieUser = 'user-2'
      await openForm()
      expect(accountField().textContent).toBe('급여통장')
    })
  })

  describe('고를 계좌가 없음', () => {
    it('판에 안내가 보이고, 저장하면 "계좌를 골라 주세요"다', async () => {
      accounts.items = []
      const opened = await openApp('/transactions/new')
      await screen.findByRole('heading', { level: 1, name: '거래 입력' })
      await waitFor(() => expect(accounts.requests.length).toBeGreaterThan(0))
      await opened.user.click(accountField())
      await untilOpened()
      expect(
        screen.getByText('고를 수 있는 계좌가 없어요. 더보기의 계좌에서 계좌를 추가하거나 숨긴 계좌를 다시 보이게 해 주세요.'),
      ).toBeTruthy()
      await opened.user.keyboard('{Escape}')
      await untilUnshielded()
      await saveAmount(opened.user)
      expect(errorOf(accountField())).toBe('계좌를 골라 주세요')
      expect(document.activeElement).toBe(accountField())
      expect(transactions.sent).toEqual([])
    })
  })

  describe('목록을 불러오지 못함', () => {
    it('판에 "불러오지 못했어요."와 "다시 시도"가 보이고, 다시 받으면 고를 수 있다', async () => {
      accounts.response = () => problem(500, 'INTERNAL_ERROR')
      const opened = await openApp('/transactions/new')
      await screen.findByRole('heading', { level: 1, name: '거래 입력' })
      await waitFor(() => expect(accounts.requests.length).toBeGreaterThan(0))
      await settle()
      await opened.user.click(accountField())
      await untilOpened()
      expect(screen.getByText('불러오지 못했어요.')).toBeTruthy()
      accounts.response = undefined
      await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
      expect(await screen.findByRole('option', { name: '지갑' })).toBeTruthy()
    })
  })
})


describe('날짜', () => {
  it('고른 날짜를 보낸다', async () => {
    const { user } = await openForm()
    await user.click(dateField())
    await untilOpened()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
    expect(dateField().textContent).toBe('11월 3일 (화)')
    await saveAmount(user)
    await waitFor(() => expect(sent()?.occurredOn).toBe('2026-11-03'))
  })

  it('서버가 범위 밖으로 거부하면 범위 문구를 칸 아래에 보인다', async () => {
    transactions.response = () =>
      problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'occurredOn', code: 'OUT_OF_RANGE', message: '개발자' }] })
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(errorOf(dateField())).toBe('2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요'))
    expect(document.activeElement).toBe(dateField())
  })
})

// 시간대마다 그 시간대의 2026-11-26 23:45:30을 오프셋으로 적는다(11월이라 로스앤젤레스는 겨울 시간 −08:00)
describe.each([
  ['Asia/Seoul', '+09:00'],
  ['UTC', 'Z'],
  ['America/Los_Angeles', '-08:00'],
  ['Pacific/Kiritimati', '+14:00'],
  ['Pacific/Pago_Pago', '-11:00'],
])('기기의 시간대가 %s일 때', (timeZone, offset) => {
  beforeEach(() => setDeviceClock(`2026-11-26T23:45:30${offset}`, timeZone))

  it('기본 날짜와 시각은 기기의 지금이고 시간대 변환 없이 그대로 보낸다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    expect(time().value).toBe('23:45')
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ occurredOn: '2026-11-26', occurredTime: '23:45' }))
  })

  it('입력한 날짜와 시각을 그대로 보낸다', async () => {
    const { user } = await openForm()
    await user.click(dateField())
    await untilOpened()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 1일 일요일' }))
    await untilUnshielded()
    await user.click(moreButton())
    await user.clear(time())
    await user.type(time(), '0005')
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ occurredOn: '2026-11-01', occurredTime: '00:05' }))
  })
})

describe('더 보기', () => {
  it('누르면 펼쳐 시각과 메모가 보이고 다시 누르면 접는다. 글자는 그대로다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    expect(moreButton().getAttribute('aria-expanded')).toBe('true')
    expect(moreButton().textContent).toBe('더 보기')
    expect(document.getElementById(moreButton().getAttribute('aria-controls')!)!.hidden).toBe(false)
    expect([time(), memo()]).toBeTruthy()
    await user.click(moreButton())
    expect(moreButton().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox', { name: '시각 (선택)' })).toBeNull()
  })

  it('시각의 기본값은 기기의 지금(분 단위)이다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    expect(time().value).toBe('12:30')
  })

  it('접혀 있어도 값은 남고 저장된다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    await user.clear(time())
    await user.type(time(), '0915')
    await user.type(memo(), '회식')
    await user.click(moreButton())
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ occurredTime: '09:15', memo: '회식' }))
  })

  it('시각을 지우면 "시각 없음"이고 null로 보낸다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    await user.click(screen.getByRole('button', { name: '지우기' }))
    expect(time().value).toBe('')
    expect(time().placeholder).toBe('시각 없음')
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ occurredTime: null }))
  })

  it.each([
    ['시각', async (user: User) => {
      await user.clear(time())
      await user.type(time(), '2460')
    }, time, '시각은 00:00부터 23:59까지 입력할 수 있어요'],
    ['메모', async (user: User) => {
      await user.click(memo())
      await user.paste('가'.repeat(501))
    }, memo, '500자까지 쓸 수 있어요'],
    ['메모(쓸 수 없는 글자)', async (user: User) => {
      await user.click(memo())
      await user.paste('회식\t2차')
    }, memo, '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'],
  ] as const)('접힌 %s에 오류가 있으면 저장할 때 펼치고 그 칸으로 초점을 옮긴다', async (_, edit, field, message) => {
    const { user } = await openForm()
    await user.click(moreButton())
    await edit(user)
    await user.click(moreButton())
    await saveAmount(user)
    expect(moreButton().getAttribute('aria-expanded')).toBe('true')
    expect(errorOf(field())).toBe(message)
    expect(document.activeElement).toBe(field())
    expect(transactions.sent).toEqual([])
  })

  it('메모는 400자를 넘으면 글자 수가 보이고, 엔터는 줄바꿈이며, 조합형 글자로 센다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    await user.click(memo())
    await user.paste('가'.repeat(400).normalize('NFD'))
    expect(screen.queryByText(/\/500$/)).toBeNull()
    await user.keyboard('{Enter}')
    expect(screen.getByText('401/500')).toBeTruthy()
    expect(memo().value.endsWith('\n')).toBe(true)
  })

  // 서버와 같이 줄바꿈(U+000A) 밖의 거부 글자를 미리 알린다(00-common 4.4의 문구, frontend 결정 #220)
  it('메모에 쓸 수 없는 글자가 있으면 칸을 벗어날 때 문구를 보이고, 줄바꿈은 받는다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    await user.click(memo())
    await user.paste('회식\u{200B}')
    await user.tab()
    expect(errorOf(memo())).toBe('쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.')
    await user.clear(memo())
    await user.type(memo(), '회식{Enter}2차')
    await user.tab()
    expect(errorOf(memo())).toBeUndefined()
  })

  it('메모는 공백을 지우지 않고 보내며 빈 글자는 null이다', async () => {
    const { user } = await openForm()
    await user.click(moreButton())
    await user.type(memo(), '  첫 줄{Enter}둘째 줄 ')
    await saveAmount(user)
    await waitFor(() => expect(sent()?.memo).toBe('  첫 줄\n둘째 줄 '))
  })

  it('비운 메모는 null로 보낸다', async () => {
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(sent()).toMatchObject({ memo: null }))
  })
})

describe('이체', () => {
  async function openTransfer() {
    const opened = await openForm()
    await opened.user.click(typeRadio('이체'))
    return opened
  }

  it('보내는 계좌와 받는 계좌가 있고 카테고리와 가맹점/내용 칸이 없다', async () => {
    await openTransfer()
    expect(accountField('보내는 계좌').textContent).toBe('급여통장')
    expect(accountField('받는 계좌').textContent).toBe('')
    expect(screen.queryByLabelText('가맹점/내용 (선택)')).toBeNull()
    expect(screen.queryByRole('button', { name: /^카테고리/ })).toBeNull()
  })

  it('받는 계좌 아래에 카드대금 도움말이 보인다', async () => {
    await openTransfer()
    const help = screen.getByText('카드대금 납부는 은행 계좌에서 카드 계좌로 이체해 입력해요. 지출로 넣으면 두 번 계산돼요.')
    expect(accountField('받는 계좌').getAttribute('aria-describedby')).toContain(help.id)
    expect(getComputedStyle(help).font).toBe('var(--text-caption)')
  })

  it('받는 계좌가 비면 "받는 계좌를 골라 주세요"다', async () => {
    const { user } = await openTransfer()
    await saveAmount(user)
    expect(errorOf(accountField('받는 계좌'))).toBe('받는 계좌를 골라 주세요')
    expect(document.activeElement).toBe(accountField('받는 계좌'))
    expect(transactions.sent).toEqual([])
  })

  it('보내는 계좌와 같은 계좌를 고르면 바로 "같은 계좌로는 이체할 수 없어요"다', async () => {
    const { user } = await openTransfer()
    await pick(user, accountField('받는 계좌'), '급여통장')
    expect(errorOf(accountField('받는 계좌'))).toBe('같은 계좌로는 이체할 수 없어요')
  })

  it('받는 계좌를 고른 뒤 보내는 계좌를 같게 바꿔도 바로 알린다', async () => {
    const { user } = await openTransfer()
    await pick(user, accountField('받는 계좌'), '신한카드')
    await untilUnshielded()
    await pick(user, accountField('보내는 계좌'), '신한카드')
    expect(errorOf(accountField('받는 계좌'))).toBe('같은 계좌로는 이체할 수 없어요')
  })

  it('계약의 이체 모양으로 보낸다', async () => {
    const { user } = await openTransfer()
    await pick(user, accountField('받는 계좌'), '신한카드')
    await user.click(moreButton())
    await user.type(memo(), '카드대금')
    await saveAmount(user, '450000')
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    const body = sent()!
    expect(Object.keys(body).toSorted()).toEqual(
      ['id', 'type', 'occurredOn', 'occurredTime', 'fromAccountId', 'toAccountId', 'amount', 'memo'].toSorted(),
    )
    expect(body).toMatchObject({
      type: 'TRANSFER',
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      fromAccountId: id.salary,
      toAccountId: id.card,
      amount: 450000,
      memo: '카드대금',
    })
  })

  it('계좌는 보내는 계좌로 가고, 돌아오면 보내는 계좌가 계좌로 간다. 금액, 날짜, 시각, 메모는 남는다', async () => {
    const { user } = await openForm()
    await pick(user, accountField(), '비상금')
    await untilUnshielded()
    await user.click(amount())
    await user.keyboard('3000')
    await user.click(moreButton())
    await user.type(memo(), '메모')
    await user.click(typeRadio('이체'))
    expect(accountField('보내는 계좌').textContent).toBe('비상금')
    await pick(user, accountField('보내는 계좌'), '지갑')
    await user.click(typeRadio('수입'))
    expect(accountField('들어온 계좌').textContent).toBe('지갑')
    expect([amount().value, dateField().textContent, time().value, memo().value]).toEqual(['3,000', '11월 26일 (목)', '12:30', '메모'])
  })

  it('다시 이체로 바꾸면 받는 계좌는 비어 있다', async () => {
    const { user } = await openTransfer()
    await pick(user, accountField('받는 계좌'), '신한카드')
    await user.click(typeRadio('지출'))
    await user.click(typeRadio('이체'))
    expect(accountField('받는 계좌').textContent).toBe('')
  })

  it('금액에서 엔터는 보내는 계좌로 간다', async () => {
    const { user } = await openTransfer()
    await user.click(amount())
    await user.keyboard('1000{Enter}')
    expect(document.activeElement).toBe(accountField('보내는 계좌'))
  })
})

describe('유형 고르기', () => {
  it('좌우 화살표 키로 옮긴다', async () => {
    const { user } = await openForm()
    typeRadio('지출').focus()
    await user.keyboard('{ArrowRight}')
    expect(typeRadio('수입').getAttribute('aria-checked')).toBe('true')
    await user.keyboard('{ArrowRight}')
    expect(typeRadio('이체').getAttribute('aria-checked')).toBe('true')
  })
})

describe('닫기', () => {
  it('바꾼 값이 없으면 바로 닫는다. 기본 계좌가 들어온 것은 바꾼 것이 아니다', async () => {
    const opened = await openForm()
    await opened.user.click(closeButton())
    await waitFor(() => expect(path(opened)).toBe('/home'))
    expect(discardQuestion()).toBeNull()
  })

  it.each([
    ['금액', async (user: User) => user.keyboard('5')],
    ['유형', async (user: User) => user.click(typeRadio('수입'))],
    ['계좌', async (user: User) => pick(user, accountField(), '지갑')],
  ])('%s을 바꿨으면 "쓰던 내용을 버릴까요?"를 묻는다', async (_, edit) => {
    const { user } = await openForm()
    await edit(user)
    await untilUnshielded()
    await user.click(closeButton())
    expect(discardQuestion()).toBeTruthy()
  })

  it('기본 계좌를 다시 골라도 바꾼 것이 아니다', async () => {
    const opened = await openForm()
    await pick(opened.user, accountField(), '급여통장')
    await untilUnshielded()
    await opened.user.click(closeButton())
    await waitFor(() => expect(path(opened)).toBe('/home'))
  })

  it('Esc로 닫는다. 고르기 판의 Esc는 판만 닫는다', async () => {
    const opened = await openForm()
    await opened.user.click(categoryField())
    await untilOpened()
    await opened.user.keyboard('{Escape}')
    await settle()
    expect(path(opened)).toBe('/transactions/new')
    await opened.user.keyboard('{Escape}')
    await waitFor(() => expect(path(opened)).toBe('/home'))
  })
})
