import { useQuery } from '@tanstack/react-query'
import { fetchMe } from './me'

/** 로그인한 사용자의 내 정보. 로그인할 때와 새로고침할 때 받는다. 내 정보를 바꾸는 화면은 저장한 뒤 다시 받게 한다. */
export function useMe({ enabled = true } = {}) {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, enabled, staleTime: Infinity })
}
