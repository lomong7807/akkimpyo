import { ApiError } from '../../api/apiError'
import { isUuid } from '../../lib/uuid'

/**
 * 장부에 속한 API의 경로(ADR 002 1절). 장부 경로는 모두 이 함수로 만든다.
 * 장부 id가 UUID 모양이 아니면 경로를 만들지 않고 읽을 수 없는 값으로 실패한다. 서버에서 받은 값이라도 주소에 넣기 전에
 * 본다(security #86 권고 b).
 */
export function ledgerPath(ledgerId: string, resource: string): `/${string}` {
  if (!isUuid(ledgerId)) throw ApiError.unreadable()
  return `/ledgers/${ledgerId}/${resource}`
}
