import { createContext, use } from 'react'

type ShowToast = (message: string) => void

/** 토스트를 보이는 함수. 앱의 ToastProvider가 넘긴다. */
export const ToastContext = createContext<ShowToast | undefined>(undefined)

/** 동작이 끝났다는 알림을 보인다. 오류는 토스트로 알리지 않는다(화면설계서 00-common 5.7). */
export function useToast(): ShowToast {
  const showToast = use(ToastContext)
  if (!showToast) throw new Error('ToastProvider 안에서만 쓴다')
  return showToast
}
