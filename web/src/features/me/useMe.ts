import { useQuery } from '@tanstack/react-query'
import { currentUserId } from '../../api/session'
import { keepCopiesOfLedgers } from '../../device/copies'
import { now } from '../../lib/clock'
import { fetchMe, type Me } from './me'
import { keepMeCopy } from './meCopy'

/**
 * 로그인한 사용자의 내 정보. 로그인할 때와 새로고침할 때 받는다. 내 정보를 바꾸는 화면은 저장한 뒤 다시 받게 한다.
 * 받을 때마다 그 사용자의 사본으로 남긴다(#234).
 */
export function useMe({ enabled = true } = {}) {
  return useQuery({ queryKey: ['me'], queryFn: fetchAndKeepMe, enabled, staleTime: Infinity })
}

/** 보낼 때와 받은 뒤의 사용자(토큰의 sub)가 같을 때만 그 사용자의 사본으로 남긴다. */
async function fetchAndKeepMe(): Promise<Me> {
  const user = currentUserId()
  const me = await fetchMe()
  if (user !== undefined && currentUserId() === user) {
    keepMeCopy(user, me)
    // 장부 목록에서 빠진 장부의 사본을 지운다(security Q4)
    void keepCopiesOfLedgers(
      user,
      me.ledgers.map(({ id }) => id),
      now(),
    ).catch(() => {})
  }
  return me
}
