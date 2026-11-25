import { ApiError } from '../../api/apiError'
import { request } from '../../api/request'

/* 내 정보의 경로와 필드 이름(#30의 응답 계약)은 이 파일에만 있다. */

export interface Ledger {
  id: string
  name: string
  /** 내 권한. 서버가 앞으로 더할 값도 그대로 담는다. */
  role: string
}

export interface Me {
  displayName: string
  /** 먼저 속한 장부가 앞이다. 하나도 없는 응답은 약속과 다르므로 받지 않는다. */
  ledgers: [Ledger, ...Ledger[]]
}

/** 실패하면 ApiError를 던진다. */
export async function fetchMe(): Promise<Me> {
  const body = await request<Partial<Me> | null | undefined>('/me')
  if (!isMe(body)) throw ApiError.unreadable()
  return body
}

function isMe(body: Partial<Me> | null | undefined): body is Me {
  const ledgers: unknown = body?.ledgers
  return (
    typeof body?.displayName === 'string' && Array.isArray(ledgers) && ledgers.length > 0 && ledgers.every(isLedger)
  )
}

function isLedger(value: Partial<Ledger> | null): value is Ledger {
  return [value?.id, value?.name, value?.role].every((field) => typeof field === 'string')
}
