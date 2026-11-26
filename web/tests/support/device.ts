import { vi } from 'vitest'
import { meOf } from './backend'

/*
 * 기기 저장소(#234)에 미리 넣어 두는 값과 남은 값. 앱과 같은 IndexedDB를 쓰므로 앱을 열기 전에도 뒤에도 부를 수 있다.
 * device 모듈은 처음 쓴 저장소에 묶이므로 부를 때마다 새로 불러와 지금 테스트의 저장소에 닿게 한다. 그래서 이것을 부른 뒤에
 * 앱 모듈을 불러오면 화면과 다른 모듈이 온다. 앱 모듈은 앱을 연 직후에 불러 둔다.
 */

async function device() {
  vi.resetModules()
  return {
    db: await import('../../src/device/deviceDb'),
    copies: await import('../../src/device/copies'),
    record: await import('../../src/device/loginRecord'),
    userData: await import('../../src/device/userData'),
  }
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
export async function seedMeCopy(userId = 'user-1', me: unknown = meOf(userId), receivedAt = Date.now() - DAY) {
  const { copies } = await device()
  await copies.saveCopy(userId, '', 'me', me, receivedAt)
}

/** 장부의 사본(계좌, 카테고리)을 둔다. */
export async function seedLedgerCopy(
  userId: string,
  ledgerId: string,
  kind: 'accounts' | 'categories',
  data: unknown,
  receivedAt = Date.now() - DAY,
) {
  const { copies } = await device()
  await copies.saveCopy(userId, ledgerId, kind, data, receivedAt)
}

/** 장부의 사본 */
export async function ledgerCopy(userId: string, ledgerId: string, kind: 'accounts' | 'categories') {
  const { copies } = await device()
  return copies.readCopy(userId, ledgerId, kind)
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
