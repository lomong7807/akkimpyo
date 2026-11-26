import { keepOnlyUserCopies } from './copies'
import { isInstantMs, isUserId, resultOf, transact } from './deviceDb'

/*
 * 마지막으로 확인한 로그인 기록(architect·security 결정 2026-11-26, #234). 기기에 한 줄만 두고 덮어쓴다.
 * 토큰은 넣지 않는다(ADR 001 결정 1). loginValue·logoutValue는 그 로그인을 확인할 때의 sessionMarks 값이다.
 * 연결 없이 앱을 열 때 "확인하지 못한 로그인"으로 열지 정하는 데만 쓴다(api/unconfirmedLogin).
 */

export interface LoginRecord {
  userId: string
  /** 로그인·가입한 시각(밀리초). 갱신은 같은 로그인이면 이어받는다 */
  loggedInAt: number
  /** 서버가 마지막으로 로그인을 확인한 시각(밀리초) */
  confirmedAt: number
  loginValue: string | null
  logoutValue: string | null
}

const KEY = 'last'

/** 기록. 없거나 모양이 틀리면 없다. 저장소를 쓸 수 없으면 DeviceUnavailable을 던진다. */
export async function readLoginRecord(): Promise<LoginRecord | undefined> {
  const value: unknown = await transact(['login'], 'readonly', (transaction) =>
    resultOf(transaction.objectStore('login').get(KEY)),
  )
  return recordOf(value)
}

export interface Confirmation {
  userId: string
  /** 확인한 시각(밀리초) */
  at: number
  loginValue: string | null
  logoutValue: string | null
  /** 로그인·가입이면 true, 갱신이면 false */
  fresh: boolean
}

/**
 * 로그인·가입·갱신을 받아들일 때 기록을 덮어쓴다. 갱신은 앞 기록이 같은 사용자이고 같은 loginValue면 loggedInAt을
 * 이어받는다. 같은 트랜잭션에서 그 사용자가 아닌 사용자의 사본을 지우고(다른 사용자가 로그인함) 메타 줄을 고친다.
 */
export function confirmLogin({ userId, at, loginValue, logoutValue, fresh }: Confirmation): Promise<void> {
  return transact(
    ['login', 'copies'],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore('login')
      const previous = recordOf(await resultOf(store.get(KEY)))
      const continued = !fresh && loginValue !== null && previous?.userId === userId && previous.loginValue === loginValue
      const record: LoginRecord = {
        userId,
        // 시계가 뒤로 갔어도 로그인 시각이 확인 시각보다 뒤가 되지 않게 한다
        loggedInAt: continued ? Math.min(previous.loggedInAt, at) : at,
        confirmedAt: at,
        loginValue,
        logoutValue,
      }
      store.put(record, KEY)
      keepOnlyUserCopies(transaction.objectStore('copies'), userId, at)
    },
    { durability: 'strict' },
  )
}

/** 기록을 지운다(로그아웃). */
export function forgetLoginRecord(): Promise<void> {
  return transact(['login'], 'readwrite', (transaction) => void transaction.objectStore('login').delete(KEY), {
    durability: 'strict',
  })
}

/**
 * 기록이 이 표시로 확인한 로그인의 것이면 지운다(갱신 401). 그사이 다른 로그인이 새로 쓴 기록은 남긴다.
 * 늦게 온 401이 다른 탭의 새 로그인을 지우지 않게 하기 위해서다(ADR 001 결정 3의 쿠키와 같은 까닭).
 */
export function forgetLoginRecordOf({ loginValue, logoutValue }: Pick<LoginRecord, 'loginValue' | 'logoutValue'>) {
  return transact(
    ['login'],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore('login')
      const record = recordOf(await resultOf(store.get(KEY)))
      if (record && record.loginValue === loginValue && record.logoutValue === logoutValue) store.delete(KEY)
    },
    { durability: 'strict' },
  )
}

function recordOf(value: unknown): LoginRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { userId, loggedInAt, confirmedAt, loginValue, logoutValue } = value as Partial<Record<keyof LoginRecord, unknown>>
  if (!isUserId(userId) || !isInstantMs(loggedInAt) || !isInstantMs(confirmedAt)) return undefined
  if (!isMark(loginValue) || !isMark(logoutValue)) return undefined
  return { userId, loggedInAt, confirmedAt, loginValue, logoutValue }
}

function isMark(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 256)
}
