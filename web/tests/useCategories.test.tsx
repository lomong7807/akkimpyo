import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, it } from 'vitest'
import { createQueryClient } from '../src/app/queryClient'
import { useCategories } from '../src/features/categories/useCategories'
import { CurrentLedgerContext } from '../src/features/me/CurrentLedgerContext'
import { recordDom } from './support/recordDom'
import { startMockServer } from './support/mockServer'

const server = startMockServer()

afterEach(cleanup)

function Names() {
  const { data } = useCategories()
  return <p>{data ? data.map((category) => category.name).join() : '받는 중'}</p>
}

it('장부가 바뀌면 그 장부의 카테고리를 새로 받고 앞 장부의 것을 보이지 않는다', async () => {
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/categories', ({ params }) =>
      HttpResponse.json({
        items: [{ id: '1', kind: 'EXPENSE', name: `${String(params.ledgerId)}의 식비`, system: false, children: [] }],
      }),
    ),
  )
  const queryClient = createQueryClient()
  const screenOf = (id: string) => (
    <QueryClientProvider client={queryClient}>
      <CurrentLedgerContext value={{ id, name: id, role: 'OWNER' }}>
        <Names />
      </CurrentLedgerContext>
    </QueryClientProvider>
  )
  const { rerender } = render(screenOf('first'))
  await screen.findByText('first의 식비')

  const dom = recordDom()
  rerender(screenOf('second'))
  expect(screen.getByText('받는 중')).toBeTruthy()
  await screen.findByText('second의 식비')
  expect(dom.sawText('first의 식비')).toBe(false)
})
