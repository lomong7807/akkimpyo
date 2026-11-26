import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SetupServer } from 'msw/node'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, vi } from 'vitest'
import { accountOf, startAccounts } from './accounts'
import { ledgerIdOf, startBackend } from './backend'
import { categoryWithChildren, startCategories } from './categories'
import { untilOpened } from './dialog'
import { stopGuardClock } from './guardClock'
import { startTransactions } from './transactions'
import { installLocks, createFakeLocks } from './webLocks'
import { installMatchMedia } from './viewport'

/* 거래 입력(D-04) 화면 테스트가 함께 쓰는 가짜 서버, 찾기, 동작 */

export const id = {
  salary: '11111111-1111-4111-8111-111111111111',
  saving: '22222222-2222-4222-8222-222222222222',
  card: '33333333-3333-4333-8333-333333333333',
  wallet: '44444444-4444-4444-8444-444444444444',
  food: 'aaaaaaaa-0000-4000-8000-000000000001',
  dining: 'aaaaaaaa-0000-4000-8000-000000000002',
  grocery: 'aaaaaaaa-0000-4000-8000-000000000003',
  traffic: 'aaaaaaaa-0000-4000-8000-000000000004',
  expenseNone: 'aaaaaaaa-0000-4000-8000-000000000005',
  pay: 'bbbbbbbb-0000-4000-8000-000000000001',
  bonus: 'bbbbbbbb-0000-4000-8000-000000000002',
  incomeNone: 'bbbbbbbb-0000-4000-8000-000000000003',
}

/** 서버는 만든 순서로 준다. 계좌 목록(G-01)의 첫 계좌는 첫 은행 계좌인 급여통장이다 */
export const accountItems = [
  { ...accountOf('신한카드', 'CARD', -120000), id: id.card },
  { ...accountOf('급여통장', 'BANK', 1500000), id: id.salary },
  { ...accountOf('비상금', 'BANK', 300000), id: id.saving },
  { ...accountOf('지갑', 'CASH', 20000), id: id.wallet },
]

export const categoryItems = [
  categoryWithChildren(id.food, 'EXPENSE', '식비', [
    [id.dining, '외식'],
    [id.grocery, '장보기'],
  ]),
  categoryWithChildren(id.traffic, 'EXPENSE', '교통'),
  categoryWithChildren(id.expenseNone, 'EXPENSE', '미분류', [], true),
  categoryWithChildren(id.pay, 'INCOME', '급여', [[id.bonus, '상여']]),
  categoryWithChildren(id.incomeNone, 'INCOME', '미분류', [], true),
]

export const LEDGER = ledgerIdOf('user-1')
export const LAST_ACCOUNT_KEY = 'akkimpyo-last-account'

/** 로그인한 user-1의 장부에 계좌, 카테고리, 거래 만들기가 되는 가짜 서버 */
export function startServer(server: SetupServer) {
  installMatchMedia(390)
  installLocks(createFakeLocks())
  const backend = startBackend(server)
  backend.cookieUser = 'user-1'
  const accounts = startAccounts(server, backend)
  accounts.items = [...accountItems]
  const categories = startCategories(server, backend)
  categories.items = [...categoryItems]
  const transactions = startTransactions(server, backend)
  return { backend, accounts, categories, transactions }
}

/**
 * 주소 `path`로 앱을 새로 연다. 닫으면 앞 화면으로 갈지 정하는 "뒤로"가 브라우저 방문 기록을 보므로(useGoBack) 실제 history를
 * 쓰는 라우터로 연다.
 */
export async function openApp(path: string) {
  vi.resetModules()
  window.history.replaceState(null, '', path)
  const { routes } = await import('../../src/app/routes')
  const { createQueryClient } = await import('../../src/app/queryClient')
  const router = createBrowserRouter(routes)
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, user: userEvent.setup() }
}

export type Opened = Awaited<ReturnType<typeof openApp>>
export type User = Opened['user']

export const heading = () => screen.getByRole('heading', { level: 1, name: '거래 입력' })
export const typeRadio = (label: string) => screen.getByRole('radio', { name: label })
export const amount = () => screen.getByRole<HTMLInputElement>('textbox', { name: /^금액/ })
export const payee = () => screen.getByLabelText<HTMLInputElement>('가맹점/내용 (선택)')
export const categoryField = () => screen.getByRole<HTMLButtonElement>('button', { name: /^카테고리 \(선택\)/ })
export const accountField = (label = '계좌') =>
  screen.getByRole<HTMLButtonElement>('button', { name: new RegExp(`^${label}( |$)`) })
export const dateField = () => screen.getByRole<HTMLButtonElement>('button', { name: /^날짜/ })
export const moreButton = () => screen.getByRole('button', { name: '더 보기' })
export const time = () => screen.getByLabelText<HTMLInputElement>('시각 (선택)')
export const memo = () => screen.getByLabelText<HTMLTextAreaElement>('메모 (선택)')
export const saveButton = () => screen.getByRole('button', { name: '저장' })
export const closeButton = () => screen.getByRole('button', { name: '닫기' })
export const discardQuestion = () => screen.queryByRole('dialog', { name: '쓰던 내용을 버릴까요?' })
export const settle = (ms = 50) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
export const path = ({ router }: Opened) => router.state.location.pathname

/** 칸 아래에 이어진 오류 문구. 없으면 없다. */
export function errorOf(control: HTMLElement): string | undefined {
  const ids = control.getAttribute('aria-describedby')?.split(' ') ?? []
  const message = ids.map((each) => document.getElementById(each)!).find((element) => element.querySelector('svg'))
  return message?.textContent
}

/** 주소로 바로 연다. 계좌 목록을 받아 기본 계좌가 들어갈 때까지 기다린다. */
export async function openForm(path = '/transactions/new') {
  const opened = await openApp(path)
  await screen.findByRole('heading', { level: 1, name: '거래 입력' })
  await waitFor(() => expect(accountField().textContent).not.toBe(''))
  return opened
}

/** 다른 화면(더보기)에서 연다. */
export async function openFromMore() {
  const opened = await openApp('/more')
  await screen.findByRole('main')
  await act(() => opened.router.navigate('/transactions/new'))
  await screen.findByRole('heading', { level: 1, name: '거래 입력' })
  await waitFor(() => expect(accountField().textContent).not.toBe(''))
  return opened
}

/** 고르기 판을 열어 이름이 `name`인 줄을 고른다. */
export async function pick(user: User, field: HTMLElement, name: string) {
  await user.click(field)
  await untilOpened()
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }))
  await act(async () => {})
}

/** 금액을 넣고 저장한다. */
export async function saveAmount(user: User, typed = '12000') {
  await user.click(amount())
  if (typed !== '') await user.keyboard(typed)
  await user.click(saveButton())
}

/** 화면을 다 쓴 뒤 저장소와 가짜 시계를 되돌린다. 화면에서 빠진 뒤의 덮개도 걷는다. */
export function resetGlobals() {
  vi.restoreAllMocks()
  stopGuardClock()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
}
