import { HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startBackend, type Backend } from './support/backend'
import { ledgerCopy } from './support/device'
import { startMockServer } from './support/mockServer'
import { credentials, settle } from './support/sessionTab'

/*
 * 받은 목록을 사본으로 남기는 사용자(security 검토, #234 A2). 보낼 때와 받은 뒤의 토큰 사용자가 같을 때만 그 사용자의 사본으로
 * 남긴다. 받는 사이 같은 탭에서 다른 계정으로 로그인했으면 앞 사용자의 목록을 남기지 않는다.
 */

const server = startMockServer()
let backend: Backend
const LEDGER = '1ed9e700-0000-4000-8000-000000000001'

beforeEach(() => {
  backend = startBackend(server)
  localStorage.clear()
})

async function openTab() {
  vi.resetModules()
  return {
    session: await import('../src/api/session'),
    ledgerCopy: await import('../src/features/me/ledgerCopy'),
  }
}

describe('받은 목록을 사본으로 남기는 사용자', () => {
  it('보낼 때와 받은 뒤의 사용자가 같으면 그 사용자의 사본으로 남긴다', async () => {
    const tab = await openTab()
    await tab.session.login(credentials)
    await tab.ledgerCopy.fetchKeepingCopy(LEDGER, 'accounts', async () => ['목록'])
    await settle()
    expect((await ledgerCopy('user-1', LEDGER, 'accounts'))?.data).toEqual(['목록'])
  })

  it('받는 사이 다른 계정으로 로그인했으면 앞 사용자의 목록을 남기지 않는다', async () => {
    const tab = await openTab()
    await tab.session.login(credentials)
    const answer = Promise.withResolvers<string[]>()
    const fetching = tab.ledgerCopy.fetchKeepingCopy(LEDGER, 'accounts', () => answer.promise)
    backend.loginUser = 'user-2'
    await tab.session.login(credentials)
    answer.resolve(['user-1의 목록'])
    expect(await fetching).toEqual(['user-1의 목록'])
    await settle()
    expect(await ledgerCopy('user-1', LEDGER, 'accounts')).toBeUndefined()
    expect(await ledgerCopy('user-2', LEDGER, 'accounts')).toBeUndefined()
  })

  it('보낼 때 로그인하지 않았으면(토큰 없음) 남기지 않는다', async () => {
    const tab = await openTab()
    backend.refreshResponse = () => HttpResponse.error()
    await tab.ledgerCopy.fetchKeepingCopy(LEDGER, 'accounts', async () => ['목록'])
    await settle()
    expect(await ledgerCopy('user-1', LEDGER, 'accounts')).toBeUndefined()
  })
})
