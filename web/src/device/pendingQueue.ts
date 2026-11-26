import { isUuid } from '../lib/uuid'
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

/** 보낼 수 없음으로 바꾸고 까닭을 남긴다(#235). 없는 항목이면 아무것도 하지 않는다. */
export async function markRejected(userId: string, id: string, rejection: Rejection): Promise<void> {
  await transact(
    ['queue'],
    'readwrite',
    async (transaction) => {
      const store = transaction.objectStore('queue')
      const row = pendingOfRow(await resultOf(store.get([userId, id])))
      if (row) store.put({ ...row, state: { kind: 'rejected', ...rejection } })
    },
    { durability: 'strict' },
  )
  changed()
}

/** 그 항목을 지운다(보내기 성공 #235, 버리기 #236). */
export async function removePending(userId: string, id: string): Promise<void> {
  await transact(['queue'], 'readwrite', (transaction) => void transaction.objectStore('queue').delete([userId, id]), {
    durability: 'strict',
  })
  changed()
}

/*
 * 바뀜 알림. 같은 탭과 다른 탭에 대기열이 바뀌었다는 것만 알리고 내용은 싣지 않는다. 받는 쪽은 저장소를 다시 읽는다
 * (security 2026-11-26). BroadcastChannel이 없는 브라우저에서는 같은 탭에만 알린다.
 */

const CHANNEL = 'akkimpyo-device'
const listeners = new Set<() => void>()
let channel: BroadcastChannel | undefined

/** 대기열이 바뀔 때마다 부른다(이 탭과 다른 탭). 돌려받은 함수로 끊는다. */
export function onPendingChanged(listener: () => void): () => void {
  listeners.add(listener)
  openChannel()
  return () => {
    listeners.delete(listener)
  }
}

/** 이 탭에서 대기열을 바꿨다. 이 탭에 알리고 다른 탭에 보낸다. */
export function changed(): void {
  listeners.forEach((notify) => notify())
  openChannel()?.postMessage({ changed: 'queue' })
}

function openChannel(): BroadcastChannel | undefined {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = ({ data }: MessageEvent<unknown>) => {
    if ((data as { changed?: unknown } | null)?.changed === 'queue') listeners.forEach((notify) => notify())
  }
  return channel
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
