import { ApiError } from '../../api/apiError'

/*
 * 서버가 꼭 필요한 동작의 문구(00-common 4.3, #238). 연결이 없으면 그 버튼을 비활성으로 두고, 띠가 보이지 않는 곳(공통 틀이 없는
 * A 그룹과 C-02, 확인 창 안, 전체 화면 입력)에서는 버튼 바로 위에 "연결되면 ~할 수 있어요"를 보인다. 요청 중에 연결이 끊기면
 * "연결이 끊겨 ~하지 못했어요."를, 서버 오류나 지연이면 "문제가 생겨 ~하지 못했어요."를 "다시 시도"와 함께 보인다.
 */

/** 문형에 넣는 동작의 말. 받침에 따라 모양이 달라 둘을 함께 적는다 */
export interface ActionWords {
  /** "연결이 끊겨 {}  못했어요"의 자리. 예: "저장하지", "계좌를 만들지" */
  failed: string
  /** "연결되면 {} 수 있어요"의 자리. 예: "저장할", "계좌를 만들" */
  able: string
}

export const SAVE: ActionWords = { failed: '저장하지', able: '저장할' }
export const LOG_IN: ActionWords = { failed: '로그인하지', able: '로그인할' }
export const SIGN_UP: ActionWords = { failed: '가입하지', able: '가입할' }
export const DELETE: ActionWords = { failed: '삭제하지', able: '삭제할' }
export const CREATE_ACCOUNT: ActionWords = { failed: '계좌를 만들지', able: '계좌를 만들' }

/** 연결이 없어 누를 수 없는 까닭("연결되면 저장할 수 있어요"). 마침표가 없다(한 문장, designer) */
export function offlineReasonOf({ able }: ActionWords): string {
  return `연결되면 ${able} 수 있어요`
}

/** 요청이 응답 없이 실패했다(요청 중 연결이 끊김). 서버 오류와 지연은 아니다 */
export function isConnectionLost(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'connection'
}

/** 동작이 실패했을 때 버튼 위의 문구. 연결이 끊긴 것과 그 밖(서버 오류, 지연, 읽을 수 없는 응답)을 나눈다 */
export function failureTextOf(error: unknown, { failed }: ActionWords): string {
  return isConnectionLost(error)
    ? `연결이 끊겨 ${failed} 못했어요. 연결되면 다시 시도해 주세요.`
    : `문제가 생겨 ${failed} 못했어요. 잠시 후 다시 시도해 주세요.`
}
