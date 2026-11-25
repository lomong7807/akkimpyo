import { useMutation } from '@tanstack/react-query'
import { ApiError } from '../../api/apiError'
import type { LoginValues } from './loginForm'

export type SignIn = (values: LoginValues) => Promise<void>

export function useLogin(signIn: SignIn) {
  return useMutation({
    mutationFn: (values: LoginValues) => signIn(values),
    // 화면을 떠나면 보낸 비밀번호를 캐시에서 바로 지운다
    gcTime: 0,
  })
}

/** 이메일이나 비밀번호가 맞지 않아 서버가 거부했는지. 무엇이 틀렸는지는 구분하지 않는다(P-105). */
export function isWrongCredentials(error: Error): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === 'VALIDATION_FAILED')
}
