import { vi } from 'vitest'
import { meOf } from './backend'
import { nowOnDevice } from './clock'

/*
 * 기기 저장소(#234)에 미리 넣어 두는 값과 남은 값. 앱과 같은 IndexedDB를 쓰므로 앱을 열기 전에도 뒤에도 부를 수 있다.
 * device 모듈은 처음 쓴 저장소에 묶이고 저장소는 테스트마다 바뀐다(setup). 그래서 테스트의 저장소마다 한 번만 모듈을 새로 불러와
 * (vi.resetModules) 그 테스트 안에서는 그것을 다시 쓴다. 앱이 열린 뒤에 모듈을 새로 불러오면 앱이 늦게 싣는 조각(#238의
 * fetchLastMonth 등)이 화면과 다른 모듈(토큰이 없는 세션)과 이어진다(#292). 앱을 여는 도우미(openApp)는 앱을 불러오기 전에
 * loadDeviceHelpers()로 먼저 불러 둔다.
 */

async function importDevice() {
  return {
    db: await import('../../src/device/deviceDb'),
    copies: await import('../../src/device/copies'),
    record: await import('../../src/device/loginRecord'),
    userData: await import('../../src/device/userData'),
    pending: await import('../../src/device/pendingQueue'),
  }
}

let loaded: { store: IDBFactory | undefined; modules: ReturnType<typeof importDevice> } | undefined

function device() {
  const store: IDBFactory | undefined = globalThis.indexedDB
  if (loaded?.store !== store) {
    vi.resetModules()
    loaded = { store, modules: importDevice() }
  }
  return loaded.modules
}

/** 이 테스트의 저장소에 닿는 도우미 모듈을 불러 둔다. 앱을 열기 전(vi.resetModules 전)에 부른다. */
export async function loadDeviceHelpers(): Promise<void> {
  await device()
}

const LOGIN = 'akkimpyo-login'
const LOGOUT = 'akkimpyo-logout'
const DONE = 'akkimpyo-logout-done'

/** 이 브라우저의 로그인·로그아웃 표시(sessionMarks) */
export const marks = { login: 'login-mark-1', logout: 'logout-mark-1' }

/** 표시를 둔다. 로그아웃 대기는 없다. */
export function setMarks({ login = marks.login, logout = marks.logout } = {}): void {
  localStorage.setItem(LOGIN, login)
  localStorage.setItem(LOGOUT, logout)
  localStorage.setItem(DONE, logout)
}

const DAY = 24 * 60 * 60 * 1000

interface Seed {
  userId?: string
  /** 확인한 시각(ISO). 없으면 기기의 지금 하루 전 */
  confirmedAt?: number
  /** 로그인한 시각. 없으면 확인한 시각과 같다 */
  loggedInAt?: number
  loginValue?: string | null
  logoutValue?: string | null
}

/** 마지막으로 확인한 로그인 기록을 둔다. 표시도 같은 값으로 둔다. */
export async function seedLogin({
  userId = 'user-1',
  confirmedAt = Date.parse('2026-11-25T12:00:00+09:00'),
  loggedInAt = confirmedAt,
  loginValue = marks.login,
  logoutValue = marks.logout,
}: Seed = {}): Promise<void> {
  setMarks({ login: loginValue ?? marks.login, logout: logoutValue ?? marks.logout })
  const { db } = await device()
  await db.transact(['login', 'copies'], 'readwrite', (transaction) => {
    transaction.objectStore('login').put({ userId, loggedInAt, confirmedAt, loginValue, logoutValue }, 'last')
    transaction.objectStore('copies').put({ userId, scope: '', kind: 'meta', confirmedAt })
  })
}

/** 내 정보의 사본을 둔다. */
export async function seedMeCopy(userId = 'user-1', me: unknown = meOf(userId), receivedAt = nowOnDevice() - DAY) {
  const { copies } = await device()
  await copies.saveCopy(userId, '', 'me', me, receivedAt)
}

/** 장부의 사본(계좌, 카테고리, 최근 한 달 내역 #238)을 둔다. */
export async function seedLedgerCopy(
  userId: string,
  ledgerId: string,
  kind: 'accounts' | 'categories' | 'transactions',
  data: unknown,
  receivedAt = nowOnDevice() - DAY,
) {
  const { copies } = await device()
  await copies.saveCopy(userId, ledgerId, kind, data, receivedAt, receivedAt)
}

/** 장부의 사본 */
export async function ledgerCopy(userId: string, ledgerId: string, kind: 'accounts' | 'categories' | 'transactions') {
  const { copies } = await device()
  return copies.readCopy(userId, ledgerId, kind)
}

/** 그 사용자의 대기열(오래된 것부터) */
export async function queueOf(userId = 'user-1') {
  const { pending } = await device()
  return pending.pendingOf(userId)
}

/** 대기열에 둔다. */
export async function seedPending(item: { userId: string; ledgerId: string; body: { id: string; type: 'EXPENSE' | 'INCOME' | 'TRANSFER' } & Record<string, unknown>; queuedAt: number }) {
  const { pending } = await device()
  await pending.queueTransaction(item)
}

/** 내 정보 사본 */
export async function meCopy(userId = 'user-1') {
  const { copies } = await device()
  return copies.readCopy(userId, '', 'me')
}

/** 로그인 기록. 없으면 없다. */
export async function loginRecord() {
  const { record } = await device()
  return record.readLoginRecord()
}

/** 기록을 지운다(다른 탭이 401로 지운 것 등). */
export async function forgetRecord() {
  const { record } = await device()
  await record.forgetLoginRecord()
}

/** 그 사용자의 기기 데이터를 지운다. */
export async function forgetUser(userId: string) {
  const { userData } = await device()
  await userData.forgetUserData(userId)
}

/** 기기 저장소의 모든 줄(저장소 이름 순서: login, copies, queue, drafts) */
export async function deviceContents(): Promise<unknown[][]> {
  const { db } = await device()
  const stores = ['login', 'copies', 'queue', 'drafts'] as const
  return db.transact([...stores], 'readonly', (transaction) =>
    Promise.all(stores.map((store) => db.resultOf(transaction.objectStore(store).getAll()))),
  )
}

/** 기기에 남은 사본의 [사용자, 장부, 종류] */
export async function copyKeys(): Promise<string[][]> {
  const { db } = await device()
  const rows = await db.transact(['copies'], 'readonly', (transaction) =>
    db.resultOf(transaction.objectStore('copies').getAll()),
  )
  return rows.map((row) => {
    const { userId, scope, kind } = row as { userId: string; scope: string; kind: string }
    return [userId, scope, kind]
  })
}
