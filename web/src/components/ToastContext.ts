import { createContext, use } from 'react'

/** 토스트 오른쪽 끝의 글자 버튼("되돌리기" 등). 누르면 토스트가 바로 사라지고 동작을 한다. */
export interface ToastAction {
  label: string
  onAction: () => void
}

export interface ToastOptions {
  /**
   * 되돌리기가 있는 토스트가 떠 있으면 걷지 않고 그것이 끝난 뒤에 보인다(되돌릴 기회를 빼앗지 않게). 사용자가 누른 동작이 아니라
   * 저절로 끝난 일의 알림(자동 보내기의 200 알림, designer #235 Q1)에 쓴다.
   */
  behindAction?: boolean
}

type ShowToast = (message: string, action?: ToastAction, options?: ToastOptions) => void

/** 토스트를 보이는 함수. 앱의 ToastProvider가 넘긴다. */
export const ToastContext = createContext<ShowToast | undefined>(undefined)

/**
 * 동작이 끝났다는 알림을 보인다. 방금 한 동작을 무를 수 있으면 버튼을 붙인다(8초).
 * 오류는 토스트로 알리지 않는다. 예외는 되돌리기 실패 하나다(화면설계서 00-common 5.7).
 */
export function useToast(): ShowToast {
  const showToast = use(ToastContext)
  if (!showToast) throw new Error('ToastProvider 안에서만 쓴다')
  return showToast
}
