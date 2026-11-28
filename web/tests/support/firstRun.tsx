import { cleanup, screen } from '@testing-library/react'
import { setupServer } from 'msw/node'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { vi } from 'vitest'
import { createQueryClient } from '../../src/app/queryClient'
import { accountOf, startAccounts } from './accounts'
import { startBackend } from './backend'
import { DEFAULT_NOW, setDeviceClock } from './clock'
import { categoryWithChildren, startCategories } from './categories'
import { renderRoutes } from './renderRoutes'
import { startTransactionList } from './transactionList'
import { savedOf } from './transactions'

/*
 * 파일의 첫 테스트만 하는 첫 실행을 테스트 밖에서 먼저 끝낸다(#363).
 *
 * vitest는 테스트 파일마다 새 프로세스에서 돈다(forks, isolate). 그래서 파일의 첫 테스트는 앱 코드를 받는 일(#291, screenCode.ts)
 * 말고도 그 프로세스에서 처음 하는 일을 한다: 앱 화면을 처음 그리고, jsdom이 앱 CSS의 선택자를 처음 맞춰 보고, 가짜 서버(msw)로
 * 첫 요청을 보내고, 역할로 칸을 처음 찾는다. 이 일은 앱의 반응이 아니라 테스트를 돌리는 기기의 일인데, 첫 테스트의 findBy·waitFor
 * 1초 안에 들어가 CPU 부하에서 첫 화면의 데이터(내역의 줄)를 그리지 못하고 실패했다.
 *
 * 그래서 파일의 테스트를 시작하기 전에 로그인한 내역(D-02)을 한 번 그려 줄이 보일 때까지 기다리고 버린다. 따로 띄운 가짜 서버로
 * 답하므로 파일의 가짜 서버와 요청 기록에는 닿지 않는다. 기기 저장소와 바꾼 전역은 그리기 전으로 되돌린다. 앱 모듈은 첫 테스트가
 * 앱을 새로 열 때(vi.resetModules) 버려진다.
 */

const USER = 'user-1'
const ACCOUNT = '44444444-4444-4444-8444-444444444444'
const CATEGORY = 'aaaaaaaa-0000-4000-8000-000000000001'
const PAYEE = '첫 실행'

/** 앱을 한 번 그리고 버린다. screenCode.ts의 beforeAll이 화면 코드를 받은 뒤 부른다. 실제 시계로 돈다. */
export async function drawAppOnce() {
  const storage = { local: { ...localStorage }, session: { ...sessionStorage } }
  const globals = (['IntersectionObserver', 'matchMedia'] as const).map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
    value: globalThis[name] as unknown,
  }))
  const server = setupServer()
  const pending = new Set<string>()
  server.events.on('request:start', ({ requestId }) => void pending.add(requestId))
  server.events.on('request:end', ({ requestId }) => void pending.delete(requestId))
  server.listen({ onUnhandledRequest: 'error' })
  const queryClient = createQueryClient()
  try {
    setDeviceClock(DEFAULT_NOW)
    // 내역의 끝을 지켜본다(jsdom에는 없다). 끝이 보이지 않는 것으로 둔다
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    } as unknown as typeof IntersectionObserver
    // 넓은 화면을 묻는다(jsdom에는 없다). 어떤 미디어 쿼리에도 맞지 않는 좁은 화면(폰)으로 둔다
    globalThis.matchMedia = (media: string) => Object.assign(new EventTarget(), { media, matches: false }) as unknown as MediaQueryList
    const backend = startBackend(server)
    backend.cookieUser = USER
    startAccounts(server, backend).items = [{ ...accountOf('지갑', 'CASH', 20000), id: ACCOUNT }]
    startCategories(server, backend).items = [categoryWithChildren(CATEGORY, 'EXPENSE', '식비')]
    const list = startTransactionList(server, backend)
    const fields = { id: '01900000-0000-7000-8000-0000000f1257', type: 'EXPENSE', accountId: ACCOUNT, categoryId: CATEGORY }
    list.months.set('2026-11', [savedOf({ ...fields, occurredOn: '2026-11-25', amount: 1000, payee: PAYEE }, USER)])

    const { routes } = await import('../../src/app/routes')
    renderRoutes(routes, '/transactions?month=2026-11', queryClient)
    // hook 한도(10초)보다 먼저 끝나, 못 그렸을 때 무엇을 못 찾았는지가 남는다
    await screen.findByRole('link', { name: new RegExp(`^${PAYEE}`) }, { timeout: 8_000 })
    // 그린 앱이 보낸 요청과 받는 코드가 다 끝난 뒤에 버린다
    await vi.dynamicImportSettled()
    while (pending.size > 0) await nextTurn()
  } finally {
    cleanup()
    queryClient.clear()
    server.close()
    restore(localStorage, storage.local)
    restore(sessionStorage, storage.session)
    // 테스트 환경은 전역을 jsdom 창으로 넘기는 접근자로 두기도 한다. 그때는 접근자를 다시 걸고 값도 다시 넣는다
    for (const { name, descriptor, value } of globals) {
      if (!descriptor) {
        Reflect.deleteProperty(globalThis, name)
        continue
      }
      Object.defineProperty(globalThis, name, descriptor)
      if (descriptor.set || descriptor.writable) Reflect.set(globalThis, name, value)
    }
  }
}

function restore(storage: Storage, saved: Record<string, string>) {
  storage.clear()
  for (const [key, value] of Object.entries(saved)) storage.setItem(key, value)
}
