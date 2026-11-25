import { useMutation } from '@tanstack/react-query'
import type { NewAccount } from './signupForm'

export type SignUp = (account: NewAccount) => Promise<void>

export function useSignup(signUp: SignUp) {
  return useMutation({
    mutationFn: (account: NewAccount) => signUp(account),
    // 화면을 떠나면 보낸 비밀번호를 캐시에서 바로 지운다
    gcTime: 0,
  })
}
