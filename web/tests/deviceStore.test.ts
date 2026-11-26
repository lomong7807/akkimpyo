import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * 기기 저장소(IndexedDB, #234)의 구조와 지우는 때. 모듈을 새로 불러와 탭마다 연결이 따로인 것을 흉내 낸다.
 * 저장소는 tests/support/setup.ts가 테스트마다 비운다.
 */

async function openDevice() {
  vi.resetModules()
  return {
    db: await import('../src/device/deviceDb'),
    copies: await import('../src/device/copies'),
    record: await import('../src/device/loginRecord'),
    userData: await import('../src/device/userData'),
  }
}

type Device = Awaited<ReturnType<typeof openDevice>>

/** 저장소 하나의 줄 전부 */
async function rowsOf({ db }: Device, store: 'login' | 'copies' | 'queue' | 'drafts'): Promise<unknown[]> {
  return db.transact([store], 'readonly', (transaction) => db.resultOf(transaction.objectStore(store).getAll()))
}

async function putRow({ db }: Device, store: 'login' | 'copies' | 'queue' | 'drafts', row: unknown, key?: string) {
  await db.transact([store], 'readwrite', (transaction) => void transaction.objectStore(store).put(row, key))
}

const DAY = 24 * 60 * 60 * 1000
const AT = Date.parse('2026-11-26T12:00:00+09:00')

const confirmation = (overrides = {}) => ({
  userId: 'user-1',
  at: AT,
  loginValue: 'login-a',
  logoutValue: 'logout-a',
  fresh: true,
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('데이터베이스', () => {
  it('처음 열면 akkimpyo 판 1에 저장소 넷과 대기열의 순서 색인을 만든다', async () => {
    const device = await openDevice()
    await rowsOf(device, 'login')
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('akkimpyo')
      request.onsuccess = () => resolve(request.result)
    })
    expect(db.version).toBe(1)
    expect([...db.objectStoreNames].sort()).toEqual(['copies', 'drafts', 'login', 'queue'])
    const transaction = db.transaction(['copies', 'queue', 'drafts', 'login'])
    expect(transaction.objectStore('copies').keyPath).toEqual(['userId', 'scope', 'kind'])
    expect(transaction.objectStore('queue').keyPath).toEqual(['userId', 'id'])
    expect(transaction.objectStore('queue').index('byQueuedAt').keyPath).toEqual(['userId', 'queuedAt'])
    expect(transaction.objectStore('drafts').keyPath).toEqual(['userId', 'form'])
    expect(transaction.objectStore('login').keyPath).toBeNull()
    db.close()
  })

  it('IndexedDB가 없으면 기기 저장소를 쓸 수 없다고 끝낸다', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const device = await openDevice()
    await expect(device.record.readLoginRecord()).rejects.toBeInstanceOf(device.db.DeviceUnavailable)
  })

  it('열기가 실패하면(사이트 데이터를 막음 등) 쓸 수 없다고 끝내고 이 탭에서는 다시 열지 않는다', async () => {
    const open = vi.fn(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    vi.stubGlobal('indexedDB', { open })
    const device = await openDevice()
    await expect(device.copies.readCopy('user-1', '', 'me')).rejects.toBeInstanceOf(device.db.DeviceUnavailable)
    await expect(device.record.readLoginRecord()).rejects.toBeInstanceOf(device.db.DeviceUnavailable)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('다른 탭이 새 판으로 열면 연결을 닫아 막지 않고, 이 탭은 그 뒤로 옛 판으로 열지 못해 쓸 수 없다고 끝낸다', async () => {
    const device = await openDevice()
    await rowsOf(device, 'login')
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('akkimpyo', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(newer.version).toBe(2)
    await expect(device.record.readLoginRecord()).rejects.toBeInstanceOf(device.db.DeviceUnavailable)
    newer.close()
  })

  it('트랜잭션 안의 요청이 실패하면 되돌리고 쓸 수 없다고 끝낸다', async () => {
    const device = await openDevice()
    await expect(
      device.db.transact(['copies'], 'readwrite', (transaction) => {
        transaction.objectStore('copies').put({ userId: 'user-1', scope: '', kind: 'me', receivedAt: 1, data: 1 })
        // 키가 될 값이 없는 줄
        transaction.objectStore('copies').put({ data: 2 })
      }),
    ).rejects.toBeInstanceOf(device.db.DeviceUnavailable)
    expect(await rowsOf(device, 'copies')).toEqual([])
  })

  it('한 사용자의 키 범위는 그 사용자의 줄만 고르고, 다른 사용자의 범위는 나머지 전부를 고른다', async () => {
    const device = await openDevice()
    const users = ['user', 'user-1', 'user-10', 'user-2', 'usera']
    for (const userId of users) {
      await putRow(device, 'copies', { userId, scope: '', kind: 'me', receivedAt: 1, data: userId })
      await putRow(device, 'copies', { userId, scope: 'ledger-1', kind: 'accounts', receivedAt: 1, data: userId })
    }
    const pick = (range: IDBKeyRange) =>
      device.db.transact(['copies'], 'readonly', (transaction) =>
        device.db.resultOf(transaction.objectStore('copies').getAll(range)),
      )
    const owners = (rows: unknown[]) => rows.map((row) => (row as { userId: string }).userId)
    expect(owners(await pick(device.db.userRange('user-1')))).toEqual(['user-1', 'user-1'])
    const others = await Promise.all(device.db.otherUsersRanges('user-1').map(pick))
    expect(owners(others.flat()).sort()).toEqual(['user', 'user', 'user-10', 'user-10', 'user-2', 'user-2', 'usera', 'usera'])
  })
})

describe('마지막으로 확인한 로그인 기록', () => {
  it('로그인·가입을 받아들이면 그때를 로그인 시각과 확인 시각으로 적는다', async () => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    expect(await device.record.readLoginRecord()).toEqual({
      userId: 'user-1',
      loggedInAt: AT,
      confirmedAt: AT,
      loginValue: 'login-a',
      logoutValue: 'logout-a',
    })
    expect(await rowsOf(device, 'login')).toHaveLength(1)
  })

  it('갱신은 같은 사용자, 같은 로그인 값이면 로그인 시각을 이어받고 확인 시각만 바꾼다', async () => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    await device.record.confirmLogin(confirmation({ at: AT + DAY, fresh: false }))
    expect(await device.record.readLoginRecord()).toMatchObject({ loggedInAt: AT, confirmedAt: AT + DAY })
  })

  it.each([
    ['다른 로그인 값', { loginValue: 'login-b' }],
    ['다른 사용자', { userId: 'user-2' }],
    ['로그인 값이 없음', { loginValue: null }],
  ])('갱신이 %s이면 로그인 시각을 모르므로 확인 시각으로 둔다', async (_, overrides) => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    await device.record.confirmLogin(confirmation({ at: AT + DAY, fresh: false, ...overrides }))
    expect(await device.record.readLoginRecord()).toMatchObject({ loggedInAt: AT + DAY, confirmedAt: AT + DAY })
  })

  it('다시 로그인하면 같은 사용자여도 로그인 시각을 새로 적는다', async () => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    await device.record.confirmLogin(confirmation({ at: AT + DAY }))
    expect(await device.record.readLoginRecord()).toMatchObject({ loggedInAt: AT + DAY })
  })

  it('기기 시계가 뒤로 갔어도 로그인 시각이 확인 시각보다 뒤가 되지 않는다', async () => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    await device.record.confirmLogin(confirmation({ at: AT - DAY, fresh: false }))
    expect(await device.record.readLoginRecord()).toMatchObject({ loggedInAt: AT - DAY, confirmedAt: AT - DAY })
  })

  it('다른 사용자로 기록을 쓰면 앞 사용자들의 사본을 지우고 그 사용자의 사본과 다른 사용자의 대기열·쓰던 값은 남긴다', async () => {
    const device = await openDevice()
    await device.copies.saveCopy('user-1', '', 'me', { name: 'user-1' }, AT)
    await device.copies.saveCopy('user-3', 'ledger-3', 'accounts', [], AT)
    await device.copies.saveCopy('user-2', '', 'me', { name: 'user-2' }, AT)
    await putRow(device, 'queue', { userId: 'user-1', id: 'tx-1', queuedAt: AT })
    await putRow(device, 'drafts', { userId: 'user-1', form: 'transaction-new' })
    await device.record.confirmLogin(confirmation({ userId: 'user-2' }))
    expect(await rowsOf(device, 'copies')).toEqual([
      { userId: 'user-2', scope: '', kind: 'me', receivedAt: AT, data: { name: 'user-2' } },
      { userId: 'user-2', scope: '', kind: 'meta', confirmedAt: AT },
    ])
    expect(await rowsOf(device, 'queue')).toHaveLength(1)
    expect(await rowsOf(device, 'drafts')).toHaveLength(1)
  })

  it('로그아웃은 기록을 지운다', async () => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    await device.record.forgetLoginRecord()
    expect(await device.record.readLoginRecord()).toBeUndefined()
  })

  it('갱신 401은 그 표시로 확인한 기록만 지우고, 그사이 다른 로그인이 쓴 기록은 남긴다', async () => {
    const device = await openDevice()
    await device.record.confirmLogin(confirmation())
    await device.record.forgetLoginRecordOf({ loginValue: 'login-old', logoutValue: 'logout-a' })
    expect(await device.record.readLoginRecord()).toBeDefined()
    await device.record.forgetLoginRecordOf({ loginValue: 'login-a', logoutValue: 'logout-old' })
    expect(await device.record.readLoginRecord()).toBeDefined()
    await device.record.forgetLoginRecordOf({ loginValue: 'login-a', logoutValue: 'logout-a' })
    expect(await device.record.readLoginRecord()).toBeUndefined()
  })

  it.each<[string, Record<string, unknown>]>([
    ['사용자 id가 빈 글자', { userId: '' }],
    ['사용자 id가 글자가 아님', { userId: 7 }],
    ['로그인 시각이 정수가 아님', { loggedInAt: 1.5 }],
    ['확인 시각이 정수가 아님', { confirmedAt: '2026-11-26' }],
    ['확인 시각이 음수', { confirmedAt: -1 }],
    ['로그인 값이 글자도 null도 아님', { loginValue: 3 }],
    ['로그아웃 값이 없음', { logoutValue: undefined }],
  ])('모양이 틀린 기록(%s)은 없는 것으로 본다', async (_, broken) => {
    const device = await openDevice()
    const valid = { userId: 'user-1', loggedInAt: AT, confirmedAt: AT, loginValue: 'a', logoutValue: null }
    await putRow(device, 'login', { ...valid, ...broken }, 'last')
    expect(await device.record.readLoginRecord()).toBeUndefined()
  })
})

describe('읽기용 사본', () => {
  it('받을 때마다 통째로 바꾸고 받은 시각을 남긴다', async () => {
    const device = await openDevice()
    await device.copies.saveCopy('user-1', 'ledger-1', 'accounts', [{ id: 'a' }, { id: 'b' }], AT)
    await device.copies.saveCopy('user-1', 'ledger-1', 'accounts', [{ id: 'c' }], AT + 1000)
    expect(await device.copies.readCopy('user-1', 'ledger-1', 'accounts')).toEqual({
      data: [{ id: 'c' }],
      receivedAt: AT + 1000,
    })
  })

  it('다른 사용자의 키로는 읽지 못하고, 키는 맞아도 줄의 주인이 다르면 없는 것으로 본다', async () => {
    const device = await openDevice()
    await device.copies.saveCopy('user-1', '', 'me', { name: '나' }, AT)
    expect(await device.copies.readCopy('user-2', '', 'me')).toBeUndefined()
    // 키 경로가 userId라 줄의 userId와 키는 늘 같다. 줄을 직접 고쳐도 키가 바뀌므로 다른 사용자의 키에 나타나지 않는다
    await putRow(device, 'copies', { userId: 'user-2', scope: '', kind: 'me', receivedAt: 'x', data: {} })
    expect(await device.copies.readCopy('user-2', '', 'me')).toBeUndefined()
  })

  it('로그아웃은 그 사용자의 사본, 대기열, 쓰던 값만 지운다', async () => {
    const device = await openDevice()
    await device.copies.saveCopy('user-1', '', 'me', {}, AT)
    await device.copies.saveCopy('user-2', '', 'me', {}, AT)
    await putRow(device, 'queue', { userId: 'user-1', id: 'tx-1', queuedAt: AT })
    await putRow(device, 'queue', { userId: 'user-2', id: 'tx-2', queuedAt: AT })
    await putRow(device, 'drafts', { userId: 'user-1', form: 'transaction-new' })
    await putRow(device, 'drafts', { userId: 'user-2', form: 'transaction-new' })
    await device.userData.forgetUserData('user-1')
    const owners = async (store: 'copies' | 'queue' | 'drafts') =>
      (await rowsOf(device, store)).map((row) => (row as { userId: string }).userId)
    expect(await owners('copies')).toEqual(['user-2'])
    expect(await owners('queue')).toEqual(['user-2'])
    expect(await owners('drafts')).toEqual(['user-2'])
  })

  describe('장부를 볼 수 없게 되어 지운 뒤(경쟁)', () => {
    const LEDGER = 'ledger-1'

    it('지우기 전에 시작한 요청의 사본은 다른 탭이 지웠어도 남기지 않고, 지운 뒤 시작한 요청의 사본은 남긴다', async () => {
      const here = await openDevice()
      await here.copies.saveCopy('user-1', LEDGER, 'accounts', ['앞'], AT, AT)
      const other = await openDevice()
      await other.copies.forgetLedgerCopies('user-1', LEDGER, AT + 10)
      await here.copies.saveCopy('user-1', LEDGER, 'accounts', ['지우기 전에 보낸 것'], AT + 20, AT + 5)
      await here.copies.saveCopy('user-1', LEDGER, 'categories', ['같은 때'], AT + 20, AT + 10)
      expect(await here.copies.readCopy('user-1', LEDGER, 'accounts')).toBeUndefined()
      expect(await here.copies.readCopy('user-1', LEDGER, 'categories')).toBeUndefined()
      await here.copies.saveCopy('user-1', LEDGER, 'accounts', ['지운 뒤 보낸 것'], AT + 30, AT + 11)
      expect((await here.copies.readCopy('user-1', LEDGER, 'accounts'))?.data).toEqual(['지운 뒤 보낸 것'])
    })

    it('내 정보의 장부 목록에서 빠져 지운 장부도 같다', async () => {
      const device = await openDevice()
      await device.copies.saveCopy('user-1', LEDGER, 'accounts', ['앞'], AT, AT)
      await device.copies.keepCopiesOfLedgers('user-1', ['ledger-2'], AT + 10)
      await device.copies.saveCopy('user-1', LEDGER, 'accounts', ['늦게 온 것'], AT + 20, AT + 5)
      expect(await device.copies.readCopy('user-1', LEDGER, 'accounts')).toBeUndefined()
      await device.copies.saveCopy('user-1', LEDGER, 'accounts', ['다시 받은 것'], AT + 30, AT + 11)
      expect((await device.copies.readCopy('user-1', LEDGER, 'accounts'))?.data).toEqual(['다시 받은 것'])
    })

    it('지운 표시는 다른 사용자와 다른 장부의 사본을 막지 않고, 내 정보 사본도 막지 않는다', async () => {
      const device = await openDevice()
      await device.copies.forgetLedgerCopies('user-1', LEDGER, AT + 10)
      await device.copies.saveCopy('user-2', LEDGER, 'accounts', ['남의 것'], AT + 20, AT)
      await device.copies.saveCopy('user-1', 'ledger-2', 'accounts', ['다른 장부'], AT + 20, AT)
      await device.copies.saveCopy('user-1', '', 'me', { name: '나' }, AT + 20, AT)
      expect(await device.copies.readCopy('user-2', LEDGER, 'accounts')).toBeDefined()
      expect(await device.copies.readCopy('user-1', 'ledger-2', 'accounts')).toBeDefined()
      expect(await device.copies.readCopy('user-1', '', 'me')).toBeDefined()
    })

    it('로그아웃은 지운 표시도 함께 지운다', async () => {
      const device = await openDevice()
      await device.copies.forgetLedgerCopies('user-1', LEDGER, AT)
      await device.userData.forgetUserData('user-1')
      expect(await rowsOf(device, 'copies')).toEqual([])
    })
  })

  describe('마지막으로 확인한 로그인부터 30일', () => {
    it.each([
      ['30일에서 1ms 모자라면 남긴다', 30 * DAY - 1, true],
      ['30일이 되면 지운다', 30 * DAY, false],
    ])('%s', async (_, elapsed, kept) => {
      const device = await openDevice()
      await device.record.confirmLogin(confirmation())
      await device.copies.saveCopy('user-1', '', 'me', {}, AT + DAY)
      await device.copies.sweepExpiredCopies(AT + elapsed)
      expect((await device.copies.readCopy('user-1', '', 'me')) !== undefined).toBe(kept)
    })

    it('기록이 갱신 401로 지워져도 메타 줄의 확인 시각으로 센다', async () => {
      const device = await openDevice()
      await device.record.confirmLogin(confirmation())
      await device.copies.saveCopy('user-1', '', 'me', {}, AT)
      await device.record.forgetLoginRecord()
      await device.copies.sweepExpiredCopies(AT + 29 * DAY)
      expect(await device.copies.readCopy('user-1', '', 'me')).toBeDefined()
      await device.copies.sweepExpiredCopies(AT + 30 * DAY)
      expect(await device.copies.readCopy('user-1', '', 'me')).toBeUndefined()
    })

    it('메타 줄이 없는 사용자의 사본은 지우고, 대기열과 쓰던 값은 남긴다', async () => {
      const device = await openDevice()
      await device.copies.saveCopy('user-1', '', 'me', {}, AT)
      await putRow(device, 'queue', { userId: 'user-1', id: 'tx-1', queuedAt: AT })
      await putRow(device, 'drafts', { userId: 'user-1', form: 'transaction-new' })
      await device.copies.sweepExpiredCopies(AT)
      expect(await rowsOf(device, 'copies')).toEqual([])
      expect(await rowsOf(device, 'queue')).toHaveLength(1)
      expect(await rowsOf(device, 'drafts')).toHaveLength(1)
    })
  })
})
