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

/** 편집 이상(소유자, 편집 가능)의 권한. 모르는 값은 보기 전용처럼 다룬다. */
const editorRoles = ['OWNER', 'MEMBER']

/** 장부의 거래, 계좌, 카테고리를 만들고 고칠 수 있다(기능정의서 1.3의 편집 이상). */
export function canEdit({ role }: Ledger): boolean {
  return editorRoles.includes(role)
}

/** 실패하면 ApiError를 던진다. */
export async function fetchMe(): Promise<Me> {
  const body = await request<unknown>('/me')
  const me = parseMe(body)
  if (!me) throw ApiError.unreadable()
  return me
}

/** 약속(#30)대로인 내 정보. 기기에 남긴 사본도 이것으로 읽는다(값은 믿지 않는다). 아니면 없다. */
export function parseMe(value: unknown): Me | undefined {
  return isMe(value as Partial<Me> | null | undefined) ? (value as Me) : undefined
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
