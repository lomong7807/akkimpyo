import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, it } from 'vitest'
import { createQueryClient } from '../src/app/queryClient'
import { useAccounts } from '../src/features/accounts/useAccounts'
import { useCreateAccount } from '../src/features/accounts/useCreateAccount'
import { CurrentLedgerContext } from '../src/features/me/CurrentLedgerContext'
import { accountOf, accountsBody } from './support/accounts'
import { startMockServer } from './support/mockServer'

/** 장부 경로는 UUID 모양의 장부 id만 받는다 */
const LEDGER = '0d0d0d0d-0000-4000-8000-000000000001'

const server = startMockServer()

afterEach(cleanup)

function Screen() {
  const { data } = useAccounts()
  const creation = useCreateAccount()
  const account = { name: '지갑', type: 'CASH', openingBalance: 0, openingDate: '2026-11-26' } as const
  return (
    <>
      <p>{data?.map(({ name }) => name).join()}</p>
      <button type="button" onClick={() => creation.mutate(account)}>
        추가
      </button>
    </>
  )
}

it('추가하면 보고 있는 목록에 바로 더하고 서버에서 다시 받는다', async () => {
  const lists = [accountsBody(accountOf('통장', 'BANK', 1)), accountsBody(accountOf('통장', 'BANK', 1), accountOf('맞춘 지갑', 'CASH', 0))]
  let requested = 0
  server.use(
    http.get(`/api/v1/ledgers/${LEDGER}/accounts`, () => {
      requested += 1
      return lists.shift()
    }),
    http.post(`/api/v1/ledgers/${LEDGER}/accounts`, () =>
      HttpResponse.json(accountOf('지갑', 'CASH', 0), { status: 201 }),
    ),
  )
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CurrentLedgerContext value={{ id: LEDGER, name: '내 가계부', role: 'OWNER' }}>
        <Screen />
      </CurrentLedgerContext>
    </QueryClientProvider>,
  )
  await screen.findByText('통장')
  await userEvent.click(screen.getByText('추가'))
  expect(await screen.findByText('통장,맞춘 지갑')).toBeTruthy()
  expect(requested).toBe(2)
})
