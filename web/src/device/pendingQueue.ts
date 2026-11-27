import { isUuid } from '../lib/uuid'
import { announce, onDeviceChange } from './changes'
import { isInstantMs, isUserId, resultOf, transact } from './deviceDb'

/*
 * 보내지 않은 새 거래의 대기열(ADR 006 결정 6, #234 B). 연결이 없을 때 저장한 새 거래만 쌓는다(수정·삭제는 쌓지 않는다).
 * 보내기(#235)와 목록·버리기(#236)도 이 모듈을 쓴다. 지우는 때는 보내기 성공, 버리기, 확인을 받은 로그아웃뿐이다.
 * 연결이 없을 때 저장하는 길이라 첫 화면 묶음에 둔다. 따로 싣는 조각이면 그 조각을 받지 못해 쌓기 자체가 실패한다.
 */

const TYPES = ['EXPENSE', 'INCOME', 'TRANSFER'] as const

/** 보낼 요청 내용(거래 만들기의 본문, #14). 화면이 만들어 넣고, 읽을 때는 화면이 다시 확인한다. */
export interface PendingBody {
  id: string
  type: (typeof TYPES)[number]
  [field: string]: unknown
}

/** 서버가 거부한 까닭. 보낼 수 없음인 항목에 남긴다(#235가 채운다). */
export interface Rejection {
  status: number
  code: string
  fieldErrors: { field: string; code: string }[]
  /** 409 ID_CONFLICT의 current. 선택 화면(#239)이 쓴다 */
  current?: unknown
  /** 거부를 받은 시각(밀리초) */
  at: number
}

export type PendingState = { kind: 'waiting' } | ({ kind: 'rejected' } & Rejection)

export interface PendingTransaction {
  schema: 1
  /** 입력한 사용자 */
  userId: string
  /** 거래 id(기기가 만든 UUID v7). 본문의 id와 같다 */
  id: string
  ledgerId: string
  /** 쌓은 시각(밀리초) */
  queuedAt: number
  state: PendingState
  body: PendingBody
}

export interface NewPending {
  userId: string
  ledgerId: string
  body: PendingBody
  queuedAt: number
}

/** 대기로 쌓는다. 같은 거래 id면 한 줄로 덮어쓴다. 디스크에 닿은 뒤 끝난다. 저장소를 쓸 수 없으면 DeviceUnavailable을 던진다. */
export async function queueTransaction({ userId, ledgerId, body, queuedAt }: NewPending): Promise<void> {
  const row: PendingTransaction = { schema: 1, userId, id: body.id, ledgerId, queuedAt, state: { kind: 'waiting' }, body }
  await transact(['queue'], 'readwrite', (transaction) => void transaction.objectStore('queue').put(row), {
    durability: 'strict',
  })
  changed()
}

/** 그 사용자의 항목. 오래된 것부터이고 같은 시각이면 거래 id 순서다. 모양이 틀린 줄은 없는 것으로 본다. */
export async function pendingOf(userId: string): Promise<PendingTransaction[]> {
  const rows: unknown[] = await transact(['queue'], 'readonly', (transaction) =>
    resultOf(
      transaction
        .objectStore('queue')
        .index('byQueuedAt')
        .getAll(IDBKeyRange.bound([userId], [userId, []])),
    ),
  )
  return rows.flatMap((row) => {
    const pending = pendingOfRow(row)
    return pending && pending.userId === userId ? [pending] : []
  })
}

/** 그 사용자의 대기와 보낼 수 없음 건수(B-04, 로그아웃 확인 창) */
export async function countPending(userId: string): Promise<{ waiting: number; rejected: number }> {
  const rows = await pendingOf(userId)
  const rejected = rows.filter(({ state }) => state.kind === 'rejected').length
  return { waiting: rows.length - rejected, rejected }
}

/** 그 사용자의 그 항목. 보내기 직전에 다시 읽는다(그사이 버렸거나 다른 탭이 바꿨을 수 있다). 없거나 모양이 틀리면 없다. */
export async function readPending(userId: string, id: string): Promise<PendingTransaction | undefined> {
  const row: unknown = await transact(['queue'], 'readonly', (transaction) =>
    resultOf(transaction.objectStore('queue').get([userId, id])),
  )
  const pending = pendingOfRow(row)
  return pending?.userId === userId ? pending : undefined
}

/** 보낸 결과. sent는 서버가 받았다(201, 200), rejected는 서버가 이유를 붙여 거부했다 */
export type Outcome = { kind: 'sent' } | ({ kind: 'rejected' } & Rejection)

/**
 * 보낸 결과로 그 항목을 지우거나(sent) 보낼 수 없음으로 바꾼다(rejected)(#235). 한 트랜잭션에서 다시 읽어, 보내기 직전에 본
 * 줄(`seen`)과 모든 칸이 같을 때만 바꾼다. 그사이 다른 탭이 고쳐 쌓았거나, 보낼 수 없음으로 바꿨거나, 버렸으면 그대로 두고
 * false다(#234 B 검토, architect #235 C).
 */
export async function settlePending(seen: PendingTransaction, outcome: Outcome): Promise<boolean> {
  const settled = await transact(
    ['queue'],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore('queue')
      const row = pendingOfRow(await resultOf(store.get([seen.userId, seen.id])))
      if (!row || !isSameRow(row, seen)) return false
      if (outcome.kind === 'sent') store.delete([seen.userId, seen.id])
      else store.put({ ...row, state: outcome })
      return true
    },
    { durability: 'strict' },
  )
  if (settled) changed()
  return settled
}

/**
 * 고쳐서 보내기(F-108, #237): 보낼 수 없음인 줄을 고친 본문의 대기로 바꾼다. 한 트랜잭션에서 다시 읽어, 고치는 화면을 연 때 본
 * 줄(`seen`)과 모든 칸이 같을 때만 바꾼다. 그사이 버려졌거나 다른 탭이 먼저 고쳐 보냈으면 그대로 두고 false다.
 * 쌓은 시각은 그대로 둬 원래 순서 자리에서 보낸다. 거래 id가 바뀌면(current 없는 409, ADR 006 결정 3) 옛 줄을 지우고 새 id의 줄을
 * 같은 트랜잭션에서 넣는다(둘 다 있거나 둘 다 없는 때가 없게, architect #237). 탭 사이 잠금은 잡지 않는다. 보낼 수 없음 줄은
 * 어느 탭의 보내기도 건드리지 않고, 버리기·다른 탭의 고치기와 겹치는 것은 위 비교가 막는다(architect #237).
 */
export async function refilePending(seen: PendingTransaction, body: PendingBody): Promise<boolean> {
  const refiled = await transact(
    ['queue'],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore('queue')
      const row = pendingOfRow(await resultOf(store.get([seen.userId, seen.id])))
      if (!row || !isSameRow(row, seen)) return false
      if (body.id !== seen.id) store.delete([seen.userId, seen.id])
      const next: PendingTransaction = { ...row, id: body.id, state: { kind: 'waiting' }, body }
      store.put(next)
      return true
    },
    { durability: 'strict' },
  )
  if (refiled) changed()
  return refiled
}

/** 그 항목을 지운다(버리기 #236). 보내기 결과로 지울 때는 settlePending을 쓴다. */
export async function removePending(userId: string, id: string): Promise<void> {
  await transact(['queue'], 'readwrite', (transaction) => void transaction.objectStore('queue').delete([userId, id]), {
    durability: 'strict',
  })
  changed()
}

/** 대기열이 바뀔 때마다 부른다(이 탭과 다른 탭, device/changes). 돌려받은 함수로 끊는다. */
export function onPendingChanged(listener: () => void): () => void {
  return onDeviceChange('queue', listener)
}

/** 이 탭에서 대기열을 바꿨다. 이 탭에 알리고 다른 탭에 보낸다. 내용은 싣지 않는다. */
function changed(): void {
  announce('queue')
}

/** 읽은 두 줄이 같은지. 둘 다 pendingOfRow로 읽어 칸의 순서가 같다. 줄은 JSON으로 만든 값만 담는다 */
function isSameRow(a: PendingTransaction, b: PendingTransaction): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pendingOfRow(value: unknown): PendingTransaction | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { schema, userId, id, ledgerId, queuedAt, state, body } = value as Partial<Record<keyof PendingTransaction, unknown>>
  if (schema !== 1 || !isUserId(userId) || !isUuid(id) || !isUuid(ledgerId) || !isInstantMs(queuedAt)) return undefined
  const parsedState = stateOf(state)
  if (!parsedState || !isBody(body, id)) return undefined
  return { schema, userId, id, ledgerId, queuedAt, state: parsedState, body }
}

function stateOf(value: unknown): PendingState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const state = value as Record<string, unknown>
  if (state.kind === 'waiting') return { kind: 'waiting' }
  if (state.kind !== 'rejected' || !Number.isSafeInteger(state.status) || typeof state.code !== 'string') return undefined
  if (!Array.isArray(state.fieldErrors) || !isInstantMs(state.at)) return undefined
  return state as PendingState
}

function isBody(value: unknown, id: string): value is PendingBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return body.id === id && TYPES.some((type) => type === body.type)
}
