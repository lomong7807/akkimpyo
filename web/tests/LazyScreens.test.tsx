import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ledgerIdOf, meOf } from './support/backend'
import { seedPending } from './support/device'
import { startMockServer } from './support/mockServer'
import { detailPath, editPath, lunch, startEditServer, untilDetail, untilEditForm } from './support/transactionEdit'
import { amount, openApp, resetGlobals, type Opened } from './support/transactionScreen'
import { recordDom } from './support/recordDom'
import { resetViewport, setViewportWidth } from './support/viewport'

/*
 * 로그인과 홈 말고는 화면 코드를 따로 싣는다(#251). 처음 열 때 화면 코드를 받는 동안 그 화면과 같은 상단 바와 뼈대가 보이고,
 * 공통 틀(하단 탭, 사이드바)은 그대로 남는다. 화면 코드는 vi.doMock으로 붙잡아 두었다가 테스트가 정할 때 보낸다.
 */

const server = startMockServer()
let started: ReturnType<typeof startEditServer>
const item = lunch()

/** 이 화면 코드를 붙잡는다. 돌려주는 함수를 부르면 보낸다. */
function hold(module: string): () => Promise<void> {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  vi.doMock(module, async (importOriginal) => {
    await gate
    return importOriginal()
  })
  return () => act(async () => release())
}

/** 상단 바에 보이는 것: 장부 이름이나 화면 이름, 누를 수 있는 것의 이름 */
function topBar(): string[] | undefined {
  const banner = screen.queryByRole('banner')
  if (!banner) return undefined
  const bar = within(banner)
  const texts = [...banner.querySelectorAll('p, h1')].map((each) => `글:${each.textContent}`)
  const named = (role: 'button' | 'link') =>
    bar.queryAllByRole(role).map((each) => `${role}:${each.getAttribute('aria-label') ?? each.textContent}`)
  return [...texts, ...named('button'), ...named('link')]
}

const tabBar = () => screen.queryByRole('navigation', { name: '주 메뉴' })

interface Split {
  name: string
  module: string
  path: string
  /** 화면 코드가 와서 그 화면이 그려졌다 */
  drawn: () => Promise<unknown>
  /** 전체 화면 입력이라 하단 탭이 없다 */
  fullScreen?: boolean
  /** 공통 틀이 없는 화면 */
  plain?: boolean
  /** 받은 뒤에 상단 바에 더해지는 것(데이터를 받은 뒤에만 보이는 버튼) */
  addedAfterData?: string[]
  signedOut?: boolean
  noAccounts?: boolean
  /** 앱을 열기 전에 기기에 둘 것 */
  seed?: () => Promise<void>
}

/** 고쳐서 보내기(#237)로 열 보낼 수 없음 입력 */
const rejectedId = '0193a000-0000-7000-8000-0000000000a1'

async function seedRejected() {
  const pending = {
    userId: 'user-1',
    ledgerId: ledgerIdOf('user-1'),
    queuedAt: Date.parse('2026-11-26T12:00:00+09:00'),
    body: {
      id: rejectedId,
      type: 'EXPENSE' as const,
      occurredOn: '2026-11-26',
      occurredTime: null,
      accountId: '11111111-1111-4111-8111-111111111111',
      categoryId: null,
      amount: 5000,
      payee: '거부된 입력',
      memo: null,
    },
  }
  await seedPending(pending)
  vi.resetModules()
  const { readPending, settlePending } = await import('../src/device/pendingQueue')
  const seen = (await readPending('user-1', rejectedId))!
  await settlePending(seen, { kind: 'rejected', status: 400, code: 'VALIDATION_FAILED', fieldErrors: [], at: pending.queuedAt })
}

const splits: Split[] = [
  {
    name: '내역',
    module: '../src/features/transactions/TransactionListPage',
    path: '/transactions?month=2026-11',
    drawn: () => screen.findByRole('button', { name: '이전 달' }),
  },
  {
    name: '거래 입력',
    module: '../src/features/transactions/TransactionNewPage',
    path: '/transactions/new',
    drawn: () => screen.findByRole('textbox', { name: /^금액/ }),
    fullScreen: true,
  },
  {
    name: '거래 상세',
    module: '../src/features/transactions/TransactionDetailPage',
    path: detailPath(item),
    drawn: untilDetail,
    addedAfterData: ['link:수정'],
  },
  {
    name: '거래 수정',
    module: '../src/features/transactions/TransactionEditPage',
    path: editPath(item),
    drawn: untilEditForm,
    fullScreen: true,
  },
  {
    name: '계좌',
    module: '../src/features/accounts/AccountsPage',
    path: '/accounts',
    drawn: () => screen.findByText('자산 합계'),
  },
  {
    name: '계좌 추가',
    module: '../src/features/accounts/AccountAddPage',
    path: '/accounts/new',
    drawn: () => screen.findByLabelText('이름'),
    fullScreen: true,
  },
  {
    name: '카테고리',
    module: '../src/features/categories/CategoriesPage',
    path: '/categories',
    drawn: () => screen.findByRole('radio', { name: '지출' }),
  },
  {
    name: '보내지 않은 입력',
    module: '../src/features/pending/PendingPage',
    path: '/pending',
    drawn: () => screen.findByText('보낼 입력이 없어요. 모두 보냈어요.'),
  },
  {
    name: '고쳐서 보내기의 거래 입력',
    module: '../src/features/pending/PendingFixPage',
    path: `/pending/${rejectedId}/edit`,
    drawn: () => screen.findByText(/^보내지 못한 이유: /),
    fullScreen: true,
    seed: seedRejected,
  },
  {
    name: '내보내기',
    module: '../src/features/export/ExportPage',
    path: '/export',
    drawn: () => screen.findByRole('radiogroup', { name: '기간' }),
  },
  {
    name: '더보기',
    module: '../src/app/MoreRoute',
    path: '/more',
    drawn: () => screen.findByRole('button', { name: '로그아웃' }),
  },
  {
    name: '찾을 수 없음',
    module: '../src/features/not-found/NotFoundPage',
    path: '/no-such-screen',
    drawn: () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' }),
  },
  {
    name: '가입',
    module: '../src/app/SignupRoute',
    path: '/signup',
    drawn: () => screen.findByLabelText('표시 이름'),
    plain: true,
    signedOut: true,
  },
  {
    name: '첫 실행 안내',
    module: '../src/app/WelcomeRoute',
    path: '/welcome',
    drawn: () => screen.findByRole('heading', { level: 1, name: '기본 카테고리를 넣어 두었어요' }),
    plain: true,
    noAccounts: true,
  },
]

beforeEach(() => {
  started = startEditServer(server)
  started.put(item)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
  vi.doUnmock('../src/features/accounts/AccountsPage')
  for (const split of splits) vi.doUnmock(split.module)
})

async function prepare(split: Split) {
  if (split.signedOut) started.backend.cookieUser = undefined
  if (split.noAccounts) started.accounts.items = []
  await split.seed?.()
}

/** 문이 로그인과 내 정보를 확인하고 그 화면의 틀을 그릴 때까지 기다린다 */
async function untilShell(split: Split) {
  if (split.plain && split.noAccounts) {
    await screen.findByRole('status')
    return
  }
  await waitFor(() => expect(topBar()).toBeDefined())
}

describe.each(splits)('$name: 화면 코드를 받는 동안', (split) => {
  it('그 화면과 같은 상단 바가 보이고, 화면이 그려진 뒤에도 같다', async () => {
    await prepare(split)
    const release = hold(split.module)
    await openApp(split.path)
    setViewportWidth(390)
    await untilShell(split)
    const shellBar = topBar()
    expect(shellBar).not.toEqual([])
    await release()
    await split.drawn()
    expect(topBar()?.filter((each) => !split.addedAfterData?.includes(each))).toEqual(shellBar)
  })

  it.runIf(!split.plain)(
    split.fullScreen ? '전체 화면 입력이라 하단 탭이 없다' : '공통 틀의 하단 탭이 그대로 남는다',
    async () => {
      await prepare(split)
      const release = hold(split.module)
      await openApp(split.path)
      setViewportWidth(390)
      await untilShell(split)
      const tabs = tabBar()
      if (split.fullScreen) expect(tabs).toBeNull()
      else expect(tabs).not.toBeNull()
      await release()
      await split.drawn()
      // 공통 틀은 다시 그리지 않는다
      expect(tabBar()).toBe(tabs)
    },
  )

  it('300ms가 지나도 오지 않으면 뼈대나 "불러오고 있어요"를 보인다', async () => {
    await prepare(split)
    const release = hold(split.module)
    await openApp(split.path)
    await untilShell(split)
    expect(await screen.findByText(/^불러오고 있어요\.?$/)).toBeTruthy()
    await release()
    await split.drawn()
  })
})

describe('가입의 틀', () => {
  it('기다림 글은 다른 화면처럼 상단 바 아래 남은 영역을 채운 내용의 가운데다(designer #257)', async () => {
    started.backend.cookieUser = undefined
    const release = hold('../src/app/SignupRoute')
    await openApp('/signup')
    const status = await screen.findByRole('status')
    const content = status.closest('main')!
    const page = content.parentElement!
    expect(getComputedStyle(page)).toMatchObject({ display: 'flex', flexDirection: 'column', minHeight: '100dvh' })
    expect(getComputedStyle(content)).toMatchObject({ display: 'flex', flexDirection: 'column', flexGrow: '1' })
    // Loading이 남은 높이를 채우고 글을 가운데에 둔다
    expect(getComputedStyle(status)).toMatchObject({ display: 'flex', alignItems: 'center', justifyContent: 'center' })
    expect(within(page).getByRole('banner')).toBeTruthy()
    await release()
    await screen.findByLabelText('표시 이름')
  })
})

describe('화면 코드를 받지 못하면', () => {
  it('그 화면의 상단 바와 공통 틀은 남고 내용 자리에 "불러오지 못했어요."가 보인다. 다시 시도하면 받는다', async () => {
    vi.doMock('../src/features/accounts/AccountsPage', () => {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/AccountsPage-x.js')
    })
    const { user } = await openApp('/accounts')
    setViewportWidth(390)
    const failure = await screen.findByRole('heading', { level: 2, name: '불러오지 못했어요.' })
    expect(within(screen.getByRole('main')).getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(failure.closest('main')).not.toBeNull()
    expect(within(screen.getByRole('banner')).getByRole('heading', { level: 1, name: '계좌' })).toBeTruthy()
    expect(tabBar()).not.toBeNull()
    vi.doUnmock('../src/features/accounts/AccountsPage')
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('자산 합계')).toBeTruthy()
  })
})

describe('미리 받기', () => {
  /** 한가해지면 바로 부른다 */
  function idleSoon() {
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => window.setTimeout(callback, 0))
  }

  function countLoads(...modules: string[]) {
    const loads: string[] = []
    for (const module of modules) {
      vi.doMock(module, async (importOriginal) => {
        loads.push(module)
        return importOriginal()
      })
    }
    return loads
  }

  const list = '../src/features/transactions/TransactionListPage'
  const entry = '../src/features/transactions/TransactionNewPage'
  const accounts = '../src/features/accounts/AccountsPage'

  async function openHome(): Promise<Opened> {
    const opened = await openApp('/home')
    await screen.findByRole('heading', { level: 1, name: '홈' })
    return opened
  }

  it('공통 틀이 그려진 뒤 한가할 때 내역과 거래 입력만 받는다. 그 뒤 처음 열 때 뼈대 없이 바로 그린다', async () => {
    idleSoon()
    const loads = countLoads(list, entry, accounts)
    const { router } = await openHome()
    await waitFor(() => expect([...loads].sort()).toEqual([entry, list].sort()))
    await settle()
    const dom = recordDom()
    await act(() => router.navigate('/transactions/new'))
    expect(amount()).toBeTruthy()
    expect(dom.sawText('불러오고 있어요.')).toBe(false)
  })

  it('편집할 수 없는 사람은 거래 입력을 받지 않는다', async () => {
    started.backend.meResponse = () => {
      const me = meOf('user-1')
      return Response.json({ ...me, ledgers: me.ledgers.map((ledger) => ({ ...ledger, role: 'VIEWER' })) })
    }
    idleSoon()
    const loads = countLoads(list, entry)
    await openHome()
    await waitFor(() => expect(loads).toEqual([list]))
    await settle()
    expect(loads).toEqual([list])
  })

  it('한가해지지 않으면 받지 않는다', async () => {
    const loads = countLoads(list, entry)
    await openHome()
    await settle()
    expect(loads).toEqual([])
  })
})

describe('전체 화면 입력', () => {
  const formOf = () => screen.getByRole('button', { name: '닫기' }).closest<HTMLElement>('[class*="_screen_"]')!

  it('틀이 올라오던 데서 이어 올라온다(처음부터 다시 올라오지 않는다)', async () => {
    const release = hold('../src/features/transactions/TransactionNewPage')
    await openApp('/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await settle()
    await release()
    await screen.findByRole('textbox', { name: /^금액/ })
    expect(formOf().style.animationDelay).toMatch(/^-\d+(\.\d+)?ms$/)
  })

  it('미리 받은 화면은 처음부터 올라온다', async () => {
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => window.setTimeout(callback, 0))
    const { router } = await openApp('/home')
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await settle()
    await act(() => router.navigate('/transactions/new'))
    expect(formOf().style.animationDelay).toBe('')
  })
})

function settle() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 50)))
}
