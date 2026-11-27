import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '../src/app/queryClient'
import { useAccounts } from '../src/features/accounts/useAccounts'
import { useCategories } from '../src/features/categories/useCategories'
import { CurrentLedgerContext } from '../src/features/me/CurrentLedgerContext'
import { ledgerKey, ledgerScope } from '../src/features/me/ledgerKey'
import { startMockServer } from './support/mockServer'
import { recordDom } from './support/recordDom'

const server = startMockServer()

// 장부 경로는 UUID 모양의 장부 id만 받는다
const first = '0f0f0f0f-0000-4000-8000-000000000001'
const second = '0f0f0f0f-0000-4000-8000-000000000002'

/** 받은 요청. 장부 id와 자원 이름 */
let requests: string[] = []

beforeEach(() => {
  requests = []
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/:resource', ({ params }) => {
      const asked = `${String(params.ledgerId)} ${String(params.resource)}`
      requests.push(asked)
      const account = { id: '1', name: asked, type: 'CASH', balance: 0 }
      const category = { id: '1', name: asked, kind: 'EXPENSE', system: false, children: [] }
      return HttpResponse.json({ items: [params.resource === 'accounts' ? account : category] })
    }),
  )
})

afterEach(cleanup)

/** 현재 장부의 계좌와 카테고리를 쓰는 화면 */
function Names() {
  const accounts = useAccounts().data
  const categories = useCategories().data
  return (
    <>
      <p>{accounts?.map(({ name }) => name).join() ?? '계좌를 받는 중'}</p>
      <p>{categories?.map(({ name }) => name).join() ?? '카테고리를 받는 중'}</p>
    </>
  )
}

function open() {
  const queryClient = createQueryClient()
  const screenOf = (...ledgerIds: string[]) => (
    <QueryClientProvider client={queryClient}>
      {ledgerIds.map((id, index) => (
        <CurrentLedgerContext key={index} value={{ id, name: id, role: 'OWNER' }}>
          <Names />
        </CurrentLedgerContext>
      ))}
    </QueryClientProvider>
  )
  return { queryClient, screenOf }
}

describe('장부에 속한 데이터의 캐시 키', () => {
  it('장부가 바뀌면 그 장부의 것을 새로 받고 앞 장부의 것을 보이지 않는다', async () => {
    const { screenOf } = open()
    const { rerender } = render(screenOf(first))
    await screen.findByText(`${first} accounts`)
    await screen.findByText(`${first} categories`)

    const dom = recordDom()
    rerender(screenOf(second))
    expect(screen.getByText('계좌를 받는 중')).toBeTruthy()
    expect(screen.getByText('카테고리를 받는 중')).toBeTruthy()
    await screen.findByText(`${second} accounts`)
    await screen.findByText(`${second} categories`)
    expect(dom.sawText(first)).toBe(false)
  })

  it('한 장부의 앞부분을 무효로 만들면 그 장부의 것만 모두 다시 받는다', async () => {
    const { queryClient, screenOf } = open()
    render(screenOf(first, second))
    await screen.findByText(`${first} accounts`)
    await screen.findByText(`${second} categories`)
    await waitFor(() => expect(requests).toHaveLength(4))

    requests = []
    await act(() => queryClient.invalidateQueries({ queryKey: ledgerScope(first) }))
    expect(requests.sort()).toEqual([`${first} accounts`, `${first} categories`])
  })

  it('앞부분은 자원 키의 앞부분과 같다', () => {
    expect(ledgerScope(first)).toEqual(['ledgers', first])
    expect(ledgerKey(first, 'accounts').slice(0, 2)).toEqual(ledgerScope(first))
  })

  it('한 자원을 무효로 만들면 그 장부의 그 자원만 다시 받는다', async () => {
    const { queryClient, screenOf } = open()
    render(screenOf(first, second))
    await screen.findByText(`${first} accounts`)
    await screen.findByText(`${second} categories`)
    await waitFor(() => expect(requests).toHaveLength(4))

    requests = []
    await act(() => queryClient.invalidateQueries({ queryKey: ledgerKey(first, 'categories') }))
    expect(requests).toEqual([`${first} categories`])
  })
})
