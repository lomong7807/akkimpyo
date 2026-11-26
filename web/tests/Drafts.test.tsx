import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './support/backend'
import { untilOpened } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { recordDom } from './support/recordDom'
import {
  amount,
  id,
  openApp,
  openForm,
  path,
  payee,
  resetGlobals,
  saveButton,
  settle,
  type User,
} from './support/transactionScreen'
import { editHeading, editPath, lunch, startEditServer } from './support/transactionEdit'
import type { Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

/*
 * 쓰던 값 보존(00-common 4.1, F-011, #234 C2, 설계 7절). 입력 화면(D-04 새 입력·수정, G-02, C-02)에서 로그인이 풀리면 쓰던 값을 그
 * 사용자의 것으로 이 기기에 남기고, 로그인 화면이 둘째 줄 "쓰던 내용은 이 기기에 남아 있어요."를 보인다. 같은 계정으로 다시
 * 로그인해 원래 주소로 돌아가면 그 화면이 채우고 지운다. 저장은 사용자가 다시 누른다. 다른 계정이면 채우지 않는다.
 * 바꾼 값이 없거나 남기지 못했으면 둘째 줄이 없다. 사용자가 로그아웃하면 남기지 않는다.
 */

const server = startMockServer()
let backend: Backend
let transactions: Transactions
let started: ReturnType<typeof startEditServer>

const ENDED = '로그인이 풀렸어요. 다시 로그인해 주세요.'
const KEPT = '쓰던 내용은 이 기기에 남아 있어요.'
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  started = startEditServer(server)
  ;({ backend, transactions } = started)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
  vi.unstubAllGlobals()
})

/** 서버가 이 브라우저의 로그인을 폐기했다. 다음 요청에서 알게 된다. */
function revoke() {
  backend.expireTokens()
  backend.cookieUser = undefined
}

async function logIn(user: User, as = 'user-1') {
  backend.loginUser = as
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

/** 로그인 화면 맨 위의 알림 */
async function loginNotice() {
  return (await screen.findByText(ENDED)).closest('[role="status"]')!.textContent
}

/** 앱과 같은 모듈의 쓰던 값 */
async function draftOf(userId: string, form: 'transaction-new' | 'transaction-edit' | 'account-add' | 'first-account') {
  const { readDraft } = await import('../src/device/draftReads')
  return readDraft(userId, form)
}

async function typeNewTransaction(user: User) {
  await user.click(amount())
  await user.keyboard('12000')
  await user.type(payee(), '점심')
}

describe('거래 입력(D-04 새 입력)', () => {
  it('바꾼 값이 있을 때 로그인이 풀리면 거래 id와 값을 남기고 로그인 화면에 두 줄을 보인다', async () => {
    const { user } = await openForm()
    await typeNewTransaction(user)
    revoke()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED + KEPT)
    const sentId = transactions.sent[0].body.id
    expect(await draftOf('user-1', 'transaction-new')).toMatchObject({
      path: '/transactions/new',
      values: { id: sentId, values: { amount: 12000, payee: '점심' } },
    })
  })

  it('남기는 동안 입력 화면은 바로 내려가고, 401로 끝난 저장의 실패 문구가 잠깐도 보이지 않는다(architect)', async () => {
    const { user } = await openForm()
    await typeNewTransaction(user)
    revoke()
    const dom = recordDom()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED + KEPT)
    expect(dom.sawText('문제가 생겨 저장하지 못했어요')).toBe(false)
  })

  it('같은 계정으로 다시 로그인하면 원래 화면에 값을 채우고, 저장하면 같은 거래 id로 보낸 뒤 쓰던 값을 지운다', async () => {
    const opened = await openForm()
    const { user } = opened
    await typeNewTransaction(user)
    revoke()
    await user.click(saveButton())
    await loginNotice()
    const sentId = transactions.sent[0].body.id
    await logIn(user)
    await waitFor(() => expect(amount().value).toBe('12,000'))
    expect(path(opened)).toBe('/transactions/new')
    expect(payee().value).toBe('점심')
    await waitFor(async () => expect(await draftOf('user-1', 'transaction-new')).toBeUndefined())
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(2))
    expect(transactions.sent[1]).toMatchObject({ user: 'user-1', body: { id: sentId, amount: 12000, payee: '점심' } })
  })

  it('다른 계정으로 로그인하면 채우지 않고 앞 계정의 쓰던 값은 남는다', async () => {
    const { user } = await openForm()
    await typeNewTransaction(user)
    revoke()
    await user.click(saveButton())
    await loginNotice()
    await logIn(user, 'user-2')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await settle(100)
    expect(amount().value).toBe('')
    expect(payee().value).toBe('')
    expect(await draftOf('user-1', 'transaction-new')).toBeDefined()
    expect(await draftOf('user-2', 'transaction-new')).toBeUndefined()
  })

  it('바꾼 값이 없으면 남기지 않고 첫 줄만 보인다', async () => {
    await openForm()
    revoke()
    const { request } = await import('../src/api/request')
    await request('/me').catch(() => {})
    expect(await loginNotice()).toBe(ENDED)
    expect(await draftOf('user-1', 'transaction-new')).toBeUndefined()
  })

  it('기기 저장소를 쓸 수 없으면 남기지 못하고 첫 줄만 보인다', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { user } = await openForm()
    await typeNewTransaction(user)
    revoke()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED)
  })

  it('사용자가 로그아웃하면 쓰던 값을 남기지 않는다', async () => {
    const { user } = await openForm()
    await typeNewTransaction(user)
    const { logout } = await import('../src/api/session')
    logout()
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(screen.queryByText(ENDED)).toBeNull()
    expect(await draftOf('user-1', 'transaction-new')).toBeUndefined()
  })

  it('다른 탭에서 로그아웃하면 이 탭의 쓰던 값을 남기지 않는다(그 탭이 지운 뒤에 남기지 않는다)', async () => {
    const { user } = await openForm()
    await typeNewTransaction(user)
    // 다른 탭이 로그아웃하고 그 사용자의 기기 데이터를 지웠다. 이 탭은 저장소 신호로 안다
    vi.resetModules()
    const other = await import('../src/api/sessionMarks')
    other.settleLogout(other.recordLogout())
    backend.cookieUser = undefined
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'akkimpyo-logout' })))
    await screen.findByLabelText('이메일')
    await settle(100)
    expect(screen.queryByText(ENDED)).toBeNull()
    expect(await draftOf('user-1', 'transaction-new')).toBeUndefined()
  })
})

describe('거래 수정(D-04 수정)', () => {
  it('다른 거래의 수정 화면에는 채우지 않고, 남긴 것은 그대로다(주소가 같을 때만 채운다)', async () => {
    const kept = lunch()
    const other = lunch({ payee: '다른 거래' })
    started.put(kept, other)
    vi.resetModules()
    const { keepDrafts } = await import('../src/device/drafts')
    const values = {
      type: 'EXPENSE',
      amount: 25000,
      payee: '남긴 값',
      categoryId: '',
      accountId: '',
      toAccountId: '',
      occurredOn: '2026-11-25',
      occurredTime: '',
      memo: '',
    }
    await keepDrafts('user-1', [
      { form: 'transaction-edit', path: editPath(kept), values: { version: kept.version, values }, savedAt: Date.now() },
    ])
    await openApp(editPath(other))
    await waitFor(() => expect(payee().value).toBe('다른 거래'))
    await settle(100)
    expect(payee().value).toBe('다른 거래')
    expect(await draftOf('user-1', 'transaction-edit')).toMatchObject({ path: editPath(kept) })
  })

  it('연 때의 version과 값을 남기고, 다시 로그인하면 채워 그 version으로 보낸다(그사이 바뀌었으면 충돌)', async () => {
    const item = lunch()
    const openedVersion = item.version
    started.put(item)
    const { user } = await openApp(editPath(item))
    await waitFor(() => expect(payee().value).toBe(String(item.payee)))
    await user.clear(payee())
    await user.type(payee(), '저녁')
    revoke()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED + KEPT)
    expect(await draftOf('user-1', 'transaction-edit')).toMatchObject({
      path: editPath(item),
      values: { version: openedVersion, values: { payee: '저녁' } },
    })
    // 그사이 다른 기기에서 고쳤다
    started.detail.items.get(String(item.id))!.version = Number(openedVersion) + 1
    backend.cookieUser = undefined
    await logIn(user)
    await waitFor(() => expect(editHeading()).not.toBeNull())
    await waitFor(() => expect(payee().value).toBe('저녁'))
    await user.click(saveButton())
    await waitFor(() => expect(started.detail.requests.update.filter((sent) => sent.user === 'user-1')).toHaveLength(1))
    const sent = started.detail.requests.update.filter((each) => each.user === 'user-1')[0]
    expect(sent.body).toMatchObject({ version: openedVersion, payee: '저녁' })
  })

  /** 수정 충돌 안내(N-04) 판 */
  const conflictSheet = () => screen.queryByRole('dialog', { name: '다른 기기에서 먼저 고쳤어요' })

  it('연 때의 값도 남기고, 다시 로그인해 충돌하면 "내 입력 다시 적용"이 그사이 다른 기기가 고친 칸을 되돌리지 않는다(#266)', async () => {
    // 연 때 {금액 25,000, 가맹점 김밥천국}(version 1)
    const item = lunch()
    started.put(item)
    const { user } = await openApp(editPath(item))
    await waitFor(() => expect(payee().value).toBe('김밥천국'))
    // 금액을 30,000으로 고치는 중에 로그인이 풀렸다
    await user.clear(amount())
    await user.keyboard('30000')
    revoke()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED + KEPT)
    expect(await draftOf('user-1', 'transaction-edit')).toMatchObject({
      values: {
        version: item.version,
        values: { amount: 30000, payee: '김밥천국' },
        openedValues: { amount: 25000, payee: '김밥천국' },
      },
    })
    // 그사이 다른 기기가 가맹점을 고쳤다(version 2)
    Object.assign(started.detail.items.get(String(item.id))!, { payee: '김밥나라', version: Number(item.version) + 1 })
    backend.cookieUser = undefined
    await logIn(user)
    await waitFor(() => expect(amount().value).toBe('30,000'))
    await user.click(saveButton())
    await waitFor(() => expect(conflictSheet()).toBeTruthy())
    await untilOpened()
    await user.click(within(conflictSheet()!).getByRole('button', { name: '내 입력 다시 적용' }))
    await waitFor(() => expect(conflictSheet()).toBeNull())
    expect(amount().value).toBe('30,000')
    expect(payee().value).toBe('김밥나라')
  })

  it('채운 쓰던 값에서 다시 로그인이 풀리면 남긴 version과 연 때의 값을 그대로 이어 남긴다(#266)', async () => {
    // 남긴 뒤 다른 기기가 가맹점을 고쳤다(version 2). 다시 연 때 받은 값은 남긴 연 때의 값과 다르다
    const item = lunch({ version: 2, payee: '김밥나라' })
    started.put(item)
    vi.resetModules()
    const { keepDrafts } = await import('../src/device/drafts')
    const openedValues = {
      type: 'EXPENSE',
      amount: 25000,
      payee: '김밥천국',
      categoryId: id.dining,
      accountId: id.wallet,
      toAccountId: '',
      occurredOn: '2026-11-25',
      occurredTime: '13:05',
      memo: '팀 점심\n영수증은 사진첩에',
    }
    const values = { ...openedValues, amount: 30000 }
    await keepDrafts('user-1', [
      { form: 'transaction-edit', path: editPath(item), values: { version: 1, values, openedValues }, savedAt: Date.now() },
    ])
    const { user } = await openApp(editPath(item))
    await waitFor(() => expect(amount().value).toBe('30,000'))
    await waitFor(async () => expect(await draftOf('user-1', 'transaction-edit')).toBeUndefined())
    revoke()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED + KEPT)
    expect((await draftOf('user-1', 'transaction-edit'))?.values).toEqual({ version: 1, values, openedValues })
  })
})

describe('계좌 추가(G-02)', () => {
  it('쓰던 값을 남기고, 같은 계정으로 다시 로그인하면 채운다', async () => {
    const opened = await openApp('/accounts/new')
    const { user } = opened
    const name = await screen.findByRole('textbox', { name: /이름/ })
    await user.type(name, '비상금')
    revoke()
    await user.click(saveButton())
    expect(await loginNotice()).toBe(ENDED + KEPT)
    await logIn(user)
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('textbox', { name: /이름/ }).value).toBe('비상금'))
    expect(path(opened)).toBe('/accounts/new')
  })
})

describe('첫 계좌(C-02)', () => {
  it('쓰던 값을 남기고, 같은 계정으로 다시 로그인하면 그 장에 채운다', async () => {
    started.accounts.items = []
    const opened = await openApp('/welcome?step=2')
    const { user } = opened
    const name = await screen.findByRole('textbox', { name: /계좌 이름/ })
    await user.type(name, '월급 통장')
    revoke()
    await user.click(screen.getByRole('button', { name: '계좌 만들기' }))
    expect(await loginNotice()).toBe(ENDED + KEPT)
    await logIn(user)
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: /계좌 이름/ }).value).toBe('월급 통장'),
    )
    expect(opened.router.state.location.search).toBe('?step=2')
  })
})

describe('남긴 때부터 30일', () => {
  it('앱을 열 때 30일이 지난 쓰던 값을 지운다', async () => {
    vi.resetModules()
    const { keepDrafts } = await import('../src/device/drafts')
    const old = { form: 'account-add' as const, path: '/accounts/new', values: {}, savedAt: Date.now() - 31 * DAY }
    const fresh = { form: 'transaction-edit' as const, path: '/transactions/x/edit', values: {}, savedAt: Date.now() - DAY }
    await keepDrafts('user-1', [old, fresh])
    await openForm()
    await waitFor(async () => expect(await draftOf('user-1', 'account-add')).toBeUndefined())
    expect(await draftOf('user-1', 'transaction-edit')).toBeDefined()
  })
})
