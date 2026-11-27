/*
 * 이 기기의 IndexedDB(ADR 006 결정 7, #234). 데이터베이스 하나에 저장소 넷을 둔다.
 * - login: 마지막으로 확인한 로그인 기록 한 줄(키 'last')
 * - copies: 읽기용 사본과 사용자별 메타. 키 [사용자 id, 장부 id(사용자 단위는 빈 글자), 종류]
 * - queue: 보내지 않은 새 거래. 키 [사용자 id, 거래 id]
 * - drafts: 로그인이 풀릴 때 남긴 쓰던 값. 키 [사용자 id, 입력 화면]
 * 사용자 데이터의 키는 모두 사용자 id로 시작해, 한 사용자의 것을 키 범위 하나로 고르고 지운다.
 *
 * device 층 안에서만 부른다(eslint.config.js). 열지 못하거나 쓰지 못하면 DeviceUnavailable로 끝내고, 부른 쪽은 기기 저장 없이
 * 앱을 계속 쓴다. 읽은 값은 믿지 않는다. 저장소마다 있는 모듈이 모양을 확인한다.
 */

const NAME = 'akkimpyo'
const VERSION = 1

/** 다른 탭이 옛 판의 연결을 닫지 않아 열기가 막혔을 때 기다리는 시간 */
const BLOCKED_MS = 15_000

export type StoreName = 'login' | 'copies' | 'queue' | 'drafts'

/** 기기 저장소를 열지 못했거나 쓰지 못했다(막힌 저장소, 용량 초과, 새 판에 밀려 닫힘 등). */
export class DeviceUnavailable extends Error {
  override readonly name = 'DeviceUnavailable'

  constructor() {
    super('기기 저장소를 쓸 수 없다')
  }
}

/**
 * 이 탭의 연결. 열지 못했으면 실패한 채로 두어 다시 열지 않는다. 새 판에 밀려 닫히면 비워 다음 작업이 다시 연다.
 * 열린 뒤에는 `ready`로 바로 써서, 부른 순서대로 트랜잭션이 기다림 없이 만들어지게 한다(로그아웃이 기록을 가장 먼저 지운다).
 */
interface Opened {
  db: Promise<IDBDatabase>
  ready?: IDBDatabase
}

let opened: Opened | undefined

/** 처음 쓸 때의 IndexedDB. 다시 열 때도 이것을 쓴다(테스트가 저장소를 바꿔도 앞 테스트의 모듈은 앞 저장소에 남는다). */
let factory: IDBFactory | undefined | null = null

function database() {
  if (factory === null) factory = typeof indexedDB === 'undefined' ? undefined : indexedDB
  if (!opened) {
    const entry: Opened = { db: open(factory) }
    entry.db.then(
      (db) => {
        if (opened === entry) entry.ready = db
      },
      () => {},
    )
    opened = entry
  }
  return opened
}

function forget(db: IDBDatabase) {
  if (opened?.ready === db) opened = undefined
}

function open(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (factory === undefined) return reject(new DeviceUnavailable())
    let request: IDBOpenDBRequest
    try {
      request = factory.open(NAME, VERSION)
    } catch {
      return reject(new DeviceUnavailable())
    }
    let blocked: ReturnType<typeof setTimeout> | undefined
    let gaveUp = false
    request.onblocked = () => {
      blocked ??= setTimeout(() => {
        gaveUp = true
        reject(new DeviceUnavailable())
      }, BLOCKED_MS)
    }
    request.onupgradeneeded = ({ oldVersion }) => upgrade(request.result, oldVersion)
    request.onsuccess = () => {
      clearTimeout(blocked)
      const db = request.result
      if (gaveUp) return db.close()
      // 다른 탭이 새 판으로 연다. 닫아 그 탭을 막지 않는다
      db.onversionchange = () => {
        db.close()
        forget(db)
      }
      db.onclose = () => forget(db)
      resolve(db)
    }
    request.onerror = () => {
      clearTimeout(blocked)
      reject(new DeviceUnavailable())
    }
  })
}

/** 판을 올리는 일. 저장소와 색인을 더하기만 하고 사용자 데이터를 지우지 않는다. 줄 안의 모양은 읽을 때 맞춘다. */
function upgrade(db: IDBDatabase, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore('login')
    db.createObjectStore('copies', { keyPath: ['userId', 'scope', 'kind'] })
    db.createObjectStore('queue', { keyPath: ['userId', 'id'] }).createIndex('byQueuedAt', ['userId', 'queuedAt'])
    db.createObjectStore('drafts', { keyPath: ['userId', 'form'] })
  }
}

interface TransactOptions {
  /** strict는 디스크에 닿은 뒤 끝난다. 사용자 입력과 지우기에 쓴다. 모르는 브라우저는 무시한다 */
  durability?: IDBTransactionDurability
}

/**
 * 트랜잭션 하나에서 `work`를 하고, 트랜잭션이 끝난(complete) 뒤에 그 결과를 준다. `work` 안에서 요청을 기다리는 사이에
 * 다른 것을 기다리지 않는다(트랜잭션이 저절로 끝난다). 실패하면 트랜잭션을 되돌리고 DeviceUnavailable을 던진다.
 */
export async function transact<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
  { durability = 'default' }: TransactOptions = {},
): Promise<T> {
  const entry = database()
  const db = entry.ready ?? (await entry.db)
  let transaction: IDBTransaction
  try {
    transaction = db.transaction(stores, mode, { durability })
  } catch {
    throw new DeviceUnavailable()
  }
  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(new DeviceUnavailable())
  })
  try {
    const value = await work(transaction)
    await finished
    return value
  } catch {
    try {
      transaction.abort()
    } catch {
      // 이미 끝났다
    }
    await finished.catch(() => {})
    throw new DeviceUnavailable()
  }
}

/** 요청 하나의 결과 */
export function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 한 사용자의 키 전부. IndexedDB의 키 순서에서 배열은 글자보다 크므로 [u, []]가 [u, …] 키의 위 끝이다. */
export function userRange(userId: string): IDBKeyRange {
  return IDBKeyRange.bound([userId], [userId, []])
}

/** 그 사용자가 아닌 키 전부(아래쪽과 위쪽 두 범위) */
export function otherUsersRanges(userId: string): IDBKeyRange[] {
  return [IDBKeyRange.upperBound([userId], true), IDBKeyRange.lowerBound([userId, []], true)]
}

/** 사용자 id로 쓸 수 있는 값인지. 기기에서 읽은 값에 쓴다. */
export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= 256
}

/** 기기 시계로 적은 시각(밀리초)인지 */
export function isInstantMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
