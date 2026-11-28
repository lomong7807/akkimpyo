import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * 마지막으로 맞춘 시각(B-04 (2-3), 작성자 판단 61, #235). 서버에서 받아 기기에 저장한 사본을 새로 고친 마지막 시각과 보내지 않은
 * 입력을 보내는 데 성공한 마지막 시각 중 늦은 것이다. 보낸 시각은 사본 저장소의 사용자 단위 줄에 두어 사본과 함께 지워진다
 * (architect #235 F). 모듈을 새로 불러와 탭마다 연결이 따로인 것을 흉내 낸다.
 */

async function openDevice() {
  vi.resetModules()
  return {
    synced: { ...(await import('../src/device/syncedAt')), ...(await import('../src/device/markSent')) },
    copies: await import('../src/device/copies'),
    userData: await import('../src/device/userData'),
    loginRecord: await import('../src/device/loginRecord'),
  }
}

const T = Date.parse('2026-11-26T12:00:00+09:00')
const LEDGER = '1ed9e700-0000-4000-8000-000000000001'
const MINUTE = 60_000

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('기준 시각', () => {
  it('한 번도 맞추지 못했으면 없다', async () => {
    const { synced } = await openDevice()
    expect(await synced.readSyncedAt('user-1')).toBeUndefined()
  })

  it('사본(내 정보, 계좌, 카테고리)을 받은 시각과 보낸 시각 중 가장 늦은 것이다', async () => {
    const { synced, copies } = await openDevice()
    await copies.saveCopy('user-1', '', 'me', { id: 'user-1' }, T)
    expect(await synced.readSyncedAt('user-1')).toBe(T)
    await copies.saveCopy('user-1', LEDGER, 'accounts', { items: [] }, T + MINUTE, T + MINUTE)
    expect(await synced.readSyncedAt('user-1')).toBe(T + MINUTE)
    await synced.markSent('user-1', T + 2 * MINUTE)
    expect(await synced.readSyncedAt('user-1')).toBe(T + 2 * MINUTE)
    await copies.saveCopy('user-1', LEDGER, 'categories', { items: [] }, T + 3 * MINUTE, T + 3 * MINUTE)
    expect(await synced.readSyncedAt('user-1')).toBe(T + 3 * MINUTE)
  })

  it('보낸 시각은 뒤로 가지 않는다(늦게 끝난 보내기가 앞선 시각을 쓰지 않는다)', async () => {
    const { synced } = await openDevice()
    await synced.markSent('user-1', T + MINUTE)
    await synced.markSent('user-1', T)
    expect(await synced.readSyncedAt('user-1')).toBe(T + MINUTE)
  })

  it('다른 사용자의 사본과 보낸 시각은 보지 않는다', async () => {
    const { synced, copies } = await openDevice()
    await copies.saveCopy('user-2', '', 'me', { id: 'user-2' }, T + MINUTE)
    await synced.markSent('user-2', T + 2 * MINUTE)
    await copies.saveCopy('user-1', '', 'me', { id: 'user-1' }, T)
    expect(await synced.readSyncedAt('user-1')).toBe(T)
  })

  it('사본이 아닌 줄(로그인 확인 시각, 장부를 지운 때)은 맞춘 시각이 아니다', async () => {
    const { synced, copies, loginRecord } = await openDevice()
    await loginRecord.confirmLogin({ userId: 'user-1', at: T + MINUTE, loginValue: null, logoutValue: null, fresh: true })
    await copies.forgetLedgerCopies('user-1', LEDGER, T + 2 * MINUTE)
    expect(await synced.readSyncedAt('user-1')).toBeUndefined()
  })

  it('로그아웃으로 그 사용자의 기기 데이터를 지우면 보낸 시각도 지운다', async () => {
    const { synced, userData } = await openDevice()
    await synced.markSent('user-1', T)
    await userData.forgetUserData('user-1')
    expect(await synced.readSyncedAt('user-1')).toBeUndefined()
  })
})

describe('사본만 고르기(#238이 쓴다, architect #235 F)', () => {
  it('사본 저장소의 줄 가운데 사본(내 정보, 계좌, 카테고리)만 준다', async () => {
    const { synced, copies, loginRecord } = await openDevice()
    await loginRecord.confirmLogin({ userId: 'user-1', at: T, loginValue: null, logoutValue: null, fresh: true })
    await copies.saveCopy('user-1', '', 'me', { id: 'user-1' }, T)
    await copies.saveCopy('user-1', LEDGER, 'accounts', { items: [] }, T, T)
    await copies.forgetLedgerCopies('user-1', '1ed9e700-0000-4000-8000-000000000002', T)
    await synced.markSent('user-1', T)
    const kinds = (await copies.copiesOf('user-1')).map(({ scope, kind }) => [scope, kind])
    expect(kinds.toSorted()).toEqual([
      ['', 'me'],
      [LEDGER, 'accounts'],
    ])
  })
})

describe('바뀜 알림', () => {
  it('사본을 저장하거나 보낸 시각을 남기면 이 탭과 다른 탭에 바뀜만 알린다(내용은 싣지 않는다)', async () => {
    const sent: unknown[] = []
    const watcher = new BroadcastChannel('akkimpyo-device')
    watcher.onmessage = ({ data }) => sent.push(data)
    const { synced, copies } = await openDevice()
    const here = vi.fn()
    const stop = synced.onSyncedChanged(here)
    await copies.saveCopy('user-1', '', 'me', { id: 'user-1' }, T)
    await synced.markSent('user-1', T + MINUTE)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).toHaveBeenCalledTimes(2)
    expect(sent).toEqual([{ changed: 'synced' }, { changed: 'synced' }])
    stop()
    watcher.close()
  })

  it('지운 장부의 늦은 응답이라 사본을 남기지 않았으면 알리지 않는다', async () => {
    const { synced, copies } = await openDevice()
    await copies.forgetLedgerCopies('user-1', LEDGER, T)
    const here = vi.fn()
    const stop = synced.onSyncedChanged(here)
    await copies.saveCopy('user-1', LEDGER, 'accounts', { items: [] }, T + MINUTE, T - MINUTE)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).not.toHaveBeenCalled()
    expect(await synced.readSyncedAt('user-1')).toBeUndefined()
    stop()
  })

  it('다른 탭이 맞추면 이 탭에 알린다. 대기열 바뀜과 섞이지 않는다', async () => {
    const { synced } = await openDevice()
    const here = vi.fn()
    const stop = synced.onSyncedChanged(here)
    const other = new BroadcastChannel('akkimpyo-device')
    other.postMessage({ changed: 'synced' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).toHaveBeenCalledTimes(1)
    other.postMessage({ changed: 'queue' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).toHaveBeenCalledTimes(1)
    stop()
    other.close()
  })
})
