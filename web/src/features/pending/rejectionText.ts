import type { Rejection } from '../../device/pendingQueue'
import { goneReference } from '../transactions/transactionRejection'

/*
 * 보낼 수 없음인 줄의 거부 이유(B-05 (6), P-226, ADR 006 결정 3). 문구는 화면설계서 B-05 "거부 이유 문구" 표와 designer #236 답이다.
 * 장부에서 나감·내보내짐, 보기 전용으로 바뀜, 장부 삭제(2단계)는 1단계에 나오지 않아 그 밖의 검증 실패로 읽힌다.
 */

export const ACCOUNT_GONE = '계좌가 삭제되어 보낼 수 없어요. 다른 계좌를 골라 보내 주세요.'
export const CATEGORY_GONE = '카테고리가 삭제되어 보낼 수 없어요. 다른 카테고리를 골라 보내 주세요.'
export const INVALID_VALUE = '입력한 값을 저장할 수 없어요. 고쳐서 보내 주세요.'
/** current가 없는 409 ID_CONFLICT(다른 장부의 id, 남이 만든 거래, 완전히 지운 거래). 사용자는 id를 모른다(designer #236) */
export const TAKEN_ID = '이미 있는 다른 거래와 겹쳐 보낼 수 없어요. 버리고 새로 입력해 주세요.'
/** current가 있는 409 ID_CONFLICT. 고르는 판은 #280이 넣는다(planner #236). 1A 거래 입력의 문구와 같은 말이다 */
export const DIFFERENT_CONTENT = '앞서 저장한 거래와 내용이 달라 보낼 수 없어요. 내역에서 확인해 주세요.'

/** 서버 응답의 code와 칸에서 (6)의 문구 */
export function rejectionText({ code, fieldErrors, current }: Pick<Rejection, 'code' | 'fieldErrors' | 'current'>): string {
  if (code === 'ID_CONFLICT') return current === undefined ? TAKEN_ID : DIFFERENT_CONTENT
  const gone = goneReference(code, fieldErrors)
  if (gone === 'account') return ACCOUNT_GONE
  if (gone === 'category') return CATEGORY_GONE
  return INVALID_VALUE
}
