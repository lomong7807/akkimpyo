import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { untilOpened, untilUnshielded } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { trashed, type TransactionDetailServer } from './support/transactionDetail'
import {
  deviceNow,
  detailPath,
  editHeading,
  editLink,
  editPath,
  lunch,
  openEdit,
  openFromDetail,
  pathOf,
  salary,
  saving,
  startEditServer,
  toastText,
  untilDetail,
  untilEditForm,
  type Item,
} from './support/transactionEdit'
import {
  accountField,
  amount,
  categoryField,
  closeButton,
  dateField,
  discardQuestion,
  errorOf,
  memo,
  moreButton,
  openApp,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  time,
  type User,
} from './support/transactionScreen'
import { resetViewport, setViewportWidth } from './support/viewport'

/* D-04 거래 수정을 열고 닫기, 상세(D-06)의 "수정"(F-208, P-213). 수정 API(#36)는 가짜 서버가 계약대로 답한다. */

const TYPE_HELP = '유형은 바꿀 수 없어요. 바꾸려면 삭제하고 새로 입력해 주세요.'

const server = startMockServer()
let backend: Backend
let detail: TransactionDetailServer
let put: (...items: Item[]) => void

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, detail, put } = startEditServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const typeValue = () => screen.getByText(TYPE_HELP).closest('[class*="field"]')!

describe('거래 상세의 "수정"(D-06 (1))', () => {
  it('상단 바 오른쪽 끝의 글자 버튼이고 이 거래의 수정 주소로 간다', async () => {
    const item = lunch()
    put(item)
    const opened = await openApp(detailPath(item))
    await untilDetail()
    const link = editLink()!
    expect(link.getAttribute('href')).toBe(editPath(item))
    expect(link.className).toContain('text')
    // 계좌(G-01)의 "추가"와 같은 자리: 상단 바의 마지막 칸
    expect(screen.getByRole('banner').lastElementChild!.contains(link)).toBe(true)
    await opened.user.click(link)
    await untilEditForm()
    expect(pathOf(opened)).toBe(editPath(item))
  })

  it('휴지통에 있는 거래에는 없다', async () => {
    const item = lunch({ version: 2, ...trashed('2026-11-26T03:15:00.123Z') })
    put(item)
    await openApp(detailPath(item))
    await untilDetail()
    expect(editLink()).toBeNull()
  })

  it('보기 전용에게는 없다', async () => {
    backend.meResponse = () => {
      const me = meOf('user-1')
      return HttpResponse.json({ ...me, ledgers: [{ ...me.ledgers[0], role: 'VIEWER' }] })
    }
    const item = lunch()
    put(item)
    await openApp(detailPath(item))
    await untilDetail()
    expect(editLink()).toBeNull()
  })

  it('불러오는 동안에는 없다', async () => {
    const item = lunch()
    put(item)
    detail.getResponse = delayed().respond
    await openApp(detailPath(item))
    await screen.findByRole('heading', { level: 1, name: '거래 상세' })
    await settle(400)
    expect(editLink()).toBeNull()
  })
})

describe('여는 길', () => {
  it('"거래 수정" 전체 화면 입력이고 하단 탭이 없다', async () => {
    const item = lunch()
    put(item)
    await openEdit(item)
    expect(editHeading()).toBeTruthy()
    setViewportWidth(390)
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
    expect(closeButton()).toBeTruthy()
  })

  it('상세에서 열면 받아 둔 거래로 바로 채우고 다시 받지 않는다', async () => {
    const item = lunch()
    put(item)
    await openFromDetail(item)
    expect(detail.requests.get).toHaveLength(1)
  })

  it('주소로 바로 열면 거래를 받는 동안 입력칸 모양의 뼈대를 보이고 저장 버튼을 숨긴다', async () => {
    const item = lunch()
    put(item)
    const answer = delayed()
    detail.getResponse = answer.respond
    await openApp(editPath(item))
    await screen.findByRole('heading', { level: 1, name: '거래 수정' })
    // 화면 코드를 받는 동안의 틀(#251)이 아니라 거래를 받는 수정 화면을 본다
    await answer.arrived
    expect(await screen.findByText('불러오고 있어요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelectorAll('[aria-hidden="true"] [class*="fieldBox"]').length).toBeGreaterThan(0)
    answer.answer(HttpResponse.json({ ...item }))
    await untilEditForm()
    expect(saveButton()).toBeTruthy()
  })

  it('불러오지 못하면 "불러오지 못했어요."와 "다시 시도"이고, 다시 받으면 채운다', async () => {
    const item = lunch()
    put(item)
    detail.getResponse = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openApp(editPath(item))
    expect(await screen.findByRole('heading', { level: 2, name: '불러오지 못했어요.' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    detail.getResponse = undefined
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await untilEditForm()
  })

  it.each(['abc', '01900000-0000-7000-8000-00000000000g'])(
    'UUID가 아닌 id(%s)는 요청하지 않고 "찾을 수 없어요."를 보인다',
    async (bad) => {
      await openApp(`/transactions/${bad}/edit`)
      expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
      await settle()
      expect(detail.requests.get).toEqual([])
    },
  )

  it('없거나 다른 장부의 거래(404)는 "찾을 수 없어요."다', async () => {
    await openApp(editPath(lunch()))
    expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '홈으로' }).getAttribute('href')).toBe('/home')
  })

  it('휴지통에 있는 거래는 고칠 수 없어 "찾을 수 없어요."다(1A)', async () => {
    const item = lunch({ version: 2, ...trashed('2026-11-26T03:15:00.123Z') })
    put(item)
    await openApp(editPath(item))
    expect(await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 수정 화면으로 돌아온다', async () => {
    const item = lunch()
    put(item)
    backend.cookieUser = undefined
    const opened = await openApp(editPath(item))
    await opened.user.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await untilEditForm()
    expect(pathOf(opened)).toBe(editPath(item))
  })
})

describe('채운 값', () => {
  it('지출: 저장된 금액, 가맹점, 카테고리, 계좌, 날짜, 시각, 메모로 채운다', async () => {
    const item = lunch()
    put(item)
    await openEdit(item)
    expect([amount().value, payee().value, categoryField().textContent, accountField().textContent]).toEqual([
      '25,000',
      '김밥천국',
      '외식',
      '지갑',
    ])
    expect(dateField().textContent).toBe('11월 25일 (수)')
    expect([time().value, memo().value]).toEqual(['13:05', '팀 점심\n영수증은 사진첩에'])
  })

  it('"더 보기"는 펼친 채 연다', async () => {
    const item = lunch()
    put(item)
    await openEdit(item)
    expect(moreButton().getAttribute('aria-expanded')).toBe('true')
    expect(time()).toBeTruthy()
  })

  it('금액에 첫 초점을 두지 않는다', async () => {
    const item = lunch()
    put(item)
    await openFromDetail(item)
    await settle()
    expect(document.activeElement).not.toBe(amount())
    expect(document.activeElement).toBe(document.body)
  })

  it('수입: 시각 없는 거래는 시각 칸이 비고, 미분류는 "미분류", 계좌 이름은 "들어온 계좌"다', async () => {
    const item = salary()
    put(item)
    await openEdit(item)
    expect(time().value).toBe('')
    expect(payee().value).toBe('')
    expect(memo().value).toBe('')
    expect(categoryField().textContent).toBe('미분류')
    expect(accountField('들어온 계좌').textContent).toBe('급여통장')
  })

  it('이체: 보내는 계좌와 받는 계좌로 채우고 가맹점/내용과 카테고리 칸이 없다', async () => {
    const item = saving()
    put(item)
    await openEdit(item)
    expect(accountField('보내는 계좌').textContent).toBe('급여통장')
    expect(accountField('받는 계좌').textContent).toBe('비상금')
    expect(screen.queryByLabelText('가맹점/내용 (선택)')).toBeNull()
    expect(screen.queryByRole('button', { name: /^카테고리/ })).toBeNull()
  })

  it('긴 메모도 그대로 채운다', async () => {
    const long = `${'가'.repeat(450)}\n끝`
    const item = lunch({ memo: long })
    put(item)
    await openEdit(item)
    expect(memo().value).toBe(long)
    expect(screen.getByText('452/500')).toBeTruthy()
  })

  it('여는 때 오류와 알림이 없다', async () => {
    const item = lunch()
    put(item)
    await openEdit(item)
    expect([amount(), payee(), accountField(), dateField()].map(errorOf)).toEqual([undefined, undefined, undefined, undefined])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('유형(D-04 (2), P-213)', () => {
  it.each([
    ['지출', lunch],
    ['수입', salary],
    ['이체', saving],
  ])('%s: 고르기 대신 이름 "유형", 값 글자, 도움말을 보인다', async (name, make) => {
    const item = make()
    put(item)
    await openEdit(item)
    expect(screen.queryByRole('radiogroup', { name: '유형' })).toBeNull()
    expect(screen.queryAllByRole('radio')).toEqual([])
    const field = within(typeValue() as HTMLElement)
    expect(field.getByText('유형').className).toContain('label')
    expect(field.getByText(name)).toBeTruthy()
    expect(getComputedStyle(field.getByText(TYPE_HELP)).font).toBe('var(--text-caption)')
  })

  it('값 글자는 본문 글자색이고 상자가 없다', async () => {
    const item = lunch()
    put(item)
    await openEdit(item)
    const value = within(typeValue() as HTMLElement).getByText('지출')
    const style = getComputedStyle(value)
    expect([style.font, style.color, style.marginTop, style.marginBottom]).toEqual([
      'var(--text-body)',
      'var(--color-text)',
      '0px',
      '0px',
    ])
    expect(style.borderTopStyle === '' || style.borderTopStyle === 'none').toBe(true)
  })

  it('유형, 금액, 가맹점/내용, 카테고리, 계좌, 날짜, 더 보기, 시각, 메모, 저장이 위에서부터 놓인다', async () => {
    const item = lunch()
    put(item)
    await openEdit(item)
    const all = [...document.querySelectorAll('*')]
    const order = [
      typeValue(),
      amount(),
      payee(),
      categoryField(),
      accountField(),
      dateField(),
      moreButton(),
      time(),
      memo(),
      saveButton(),
    ]
    const positions = order.map((element) => all.indexOf(element))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })
})

describe('닫기', () => {
  it('바꾼 값이 없으면 묻지 않고 요청 없이 상세로 돌아간다. 토스트는 없다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.click(closeButton())
    await untilDetail()
    expect(pathOf(opened)).toBe(detailPath(item))
    expect(discardQuestion()).toBeNull()
    expect(detail.requests.update).toEqual([])
    expect(toastText()).toBe('')
  })

  it('주소로 바로 열었으면 닫을 때 그 거래의 상세로 간다', async () => {
    const item = lunch()
    put(item)
    const opened = await openEdit(item)
    await opened.user.click(closeButton())
    await waitFor(() => expect(pathOf(opened)).toBe(detailPath(item)))
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it.each([
    ['Esc', async ({ user }: { user: User }) => user.keyboard('{Escape}')],
    ['브라우저의 뒤로', async ({ router }: { router: { navigate: (to: number) => Promise<void> } }) => act(() => router.navigate(-1))],
  ])('%s도 닫기와 같다', async (_, close) => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await close(opened)
    await waitFor(() => expect(pathOf(opened)).toBe(detailPath(item)))
    expect(discardQuestion()).toBeNull()
  })

  it.each([
    ['금액', async (user: User) => {
      await user.click(amount())
      await user.keyboard('1')
    }],
    ['가맹점/내용', async (user: User) => {
      await user.click(payee())
      await user.keyboard('!')
    }],
    ['계좌', async (user: User) => pick(user, accountField(), '급여통장')],
    ['시각', async (user: User) => user.clear(time())],
  ])('%s을 바꿨으면 "쓰던 내용을 버릴까요?"를 묻는다', async (_, edit) => {
    const item = lunch()
    put(item)
    const { user } = await openFromDetail(item)
    await edit(user)
    await untilUnshielded()
    await user.click(closeButton())
    expect(discardQuestion()).toBeTruthy()
  })

  it('"계속 쓰기"는 입력을 남기고, "버리기"는 요청 없이 상세로 돌아가 원래 값을 보인다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.click(amount())
    await opened.user.keyboard('1')
    await opened.user.click(closeButton())
    await untilOpened()
    await opened.user.click(within(discardQuestion()!).getByRole('button', { name: '계속 쓰기' }))
    await waitFor(() => expect(discardQuestion()).toBeNull())
    expect(amount().value).toBe('250,001')
    await untilUnshielded()
    await opened.user.click(closeButton())
    await untilOpened()
    await opened.user.click(within(discardQuestion()!).getByRole('button', { name: '버리기' }))
    await untilDetail()
    expect(within(screen.getByRole('main')).getByText('25,000원')).toBeTruthy()
    expect(detail.requests.update).toEqual([])
  })

  it('바꿨다가 되돌린 값은 바꾸지 않은 것이다', async () => {
    const item = lunch()
    put(item)
    const opened = await openFromDetail(item)
    await opened.user.click(amount())
    await opened.user.keyboard('1{Backspace}')
    await pick(opened.user, accountField(), '급여통장')
    await untilUnshielded()
    await pick(opened.user, accountField(), '지갑')
    await untilUnshielded()
    await opened.user.click(closeButton())
    await waitFor(() => expect(pathOf(opened)).toBe(detailPath(item)))
    expect(discardQuestion()).toBeNull()
  })
})
