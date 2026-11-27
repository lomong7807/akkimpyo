import { describe, expect, it, vi } from 'vitest'

/*
 * 쓰던 값(drafts, 00-common 4.1, #234 C2, 설계 7절). 로그인이 풀리는 순간 입력 화면의 값을 그 사용자의 것으로 남기고, 같은 계정으로
 * 다시 로그인하면 그 화면이 읽어 채운 뒤 지운다. 키의 첫 칸이 사용자 id라 다른 사용자에게 보이지 않는다(planner Q12).
 * 로그아웃 때(forgetUserData) 지우고, 남긴 때부터 30일이 지나면 앱을 열 때 지운다(security 권고).
 */

const DAY = 24 * 60 * 60 * 1000
const AT = Date.parse('2026-11-26T12:00:00+09:00')

async function openDevice() {
  vi.resetModules()
  return {
    db: await import('../src/device/deviceDb'),
    drafts: await import('../src/device/drafts'),
    reads: await import('../src/device/draftReads'),
    userData: await import('../src/device/userData'),
  }
}

type Device = Awaited<ReturnType<typeof openDevice>>

async function rows({ db }: Device): Promise<unknown[]> {
  return db.transact(['drafts'], 'readonly', (transaction) => db.resultOf(transaction.objectStore('drafts').getAll()))
}

const draftOf = (form: 'transaction-new' | 'account-add', overrides = {}) => ({
  form,
  path: form === 'transaction-new' ? '/transactions/new' : '/accounts/new',
  values: { amount: 12000, payee: '점심' },
  savedAt: AT,
  ...overrides,
})

describe('쓰던 값 저장소', () => {
  it('그 사용자의 것으로 남기고 읽는다. 같은 화면이면 하나로 덮어쓴다', async () => {
    const device = await openDevice()
    await device.drafts.keepDrafts('user-1', [draftOf('transaction-new'), draftOf('account-add')])
    await device.drafts.keepDrafts('user-1', [draftOf('transaction-new', { values: { amount: 3000 } })])
    expect(await device.reads.readDraft('user-1', 'transaction-new')).toEqual(
      draftOf('transaction-new', { values: { amount: 3000 } }),
    )
    expect(await device.reads.readDraft('user-1', 'account-add')).toEqual(draftOf('account-add'))
    expect(await rows(device)).toHaveLength(2)
  })

  it('다른 사용자의 것은 읽지 않는다', async () => {
    const device = await openDevice()
    await device.drafts.keepDrafts('user-1', [draftOf('transaction-new')])
    expect(await device.reads.readDraft('user-2', 'transaction-new')).toBeUndefined()
  })

  it('읽은 뒤 지우면 그 화면의 것만 사라진다', async () => {
    const device = await openDevice()
    await device.drafts.keepDrafts('user-1', [draftOf('transaction-new'), draftOf('account-add')])
    await device.drafts.keepDrafts('user-2', [draftOf('transaction-new')])
    await device.reads.removeDraft('user-1', 'transaction-new')
    expect(await device.reads.readDraft('user-1', 'transaction-new')).toBeUndefined()
    expect(await device.reads.readDraft('user-1', 'account-add')).toBeDefined()
    expect(await device.reads.readDraft('user-2', 'transaction-new')).toBeDefined()
  })

  it('모양이 약속과 다른 줄은 없는 것으로 본다', async () => {
    const device = await openDevice()
    const put = (row: unknown) =>
      device.db.transact(['drafts'], 'readwrite', (transaction) => void transaction.objectStore('drafts').put(row))
    await put({ userId: 'user-1', form: 'transaction-new', path: 3, values: {}, savedAt: AT })
    await put({ userId: 'user-1', form: 'account-add', path: '/accounts/new', values: {}, savedAt: 'yesterday' })
    expect(await device.reads.readDraft('user-1', 'transaction-new')).toBeUndefined()
    expect(await device.reads.readDraft('user-1', 'account-add')).toBeUndefined()
  })

  it('로그아웃은 그 사용자의 쓰던 값을 지우고 다른 사용자의 것은 남긴다', async () => {
    const device = await openDevice()
    await device.drafts.keepDrafts('user-1', [draftOf('transaction-new')])
    await device.drafts.keepDrafts('user-2', [draftOf('transaction-new')])
    await device.userData.forgetUserData('user-1')
    expect(await device.reads.readDraft('user-1', 'transaction-new')).toBeUndefined()
    expect(await device.reads.readDraft('user-2', 'transaction-new')).toBeDefined()
  })

  describe('남긴 때부터 30일', () => {
    it('30일이 지나면 지우고, 그 전이면 남긴다(경계: 30일 0ms 앞은 남김)', async () => {
      const device = await openDevice()
      await device.drafts.keepDrafts('user-1', [draftOf('transaction-new', { savedAt: AT - 30 * DAY })])
      await device.drafts.keepDrafts('user-1', [draftOf('account-add', { savedAt: AT - 30 * DAY + 1 })])
      await device.drafts.keepDrafts('user-2', [draftOf('transaction-new', { savedAt: AT - 31 * DAY })])
      await device.drafts.sweepExpiredDrafts(AT)
      expect(await device.reads.readDraft('user-1', 'transaction-new')).toBeUndefined()
      expect(await device.reads.readDraft('user-1', 'account-add')).toBeDefined()
      expect(await device.reads.readDraft('user-2', 'transaction-new')).toBeUndefined()
    })

    it('남긴 때가 시각이 아닌 줄도 지운다', async () => {
      const device = await openDevice()
      await device.db.transact(['drafts'], 'readwrite', (transaction) =>
        void transaction.objectStore('drafts').put({ userId: 'user-1', form: 'account-add', path: '/accounts/new', values: {}, savedAt: null }),
      )
      await device.drafts.sweepExpiredDrafts(AT)
      expect(await rows(device)).toEqual([])
    })
  })
})
