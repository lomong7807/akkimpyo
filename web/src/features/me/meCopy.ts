import { useQuery } from '@tanstack/react-query'
import { readCopy, saveCopy, USER_SCOPE } from '../../device/copies'
import { now } from '../../lib/clock'
import { deviceKey } from './deviceKey'
import { parseMe, type Me } from './me'

/*
 * 내 정보(표시 이름, 장부 목록)의 읽기용 사본(#234, security Q1). 연결 없이 앱을 열 때 '확인하지 못한 로그인'의 공통 틀과
 * 현재 장부를 그린다. 지우는 때는 계좌·카테고리 사본과 같다(device/copies).
 */

/** 서버에서 받은 내 정보를 그 사용자의 사본으로 통째로 남긴다. 기다리지 않고, 실패해도 화면은 그대로다. */
export function keepMeCopy(userId: string, me: Me): void {
  void saveCopy(userId, USER_SCOPE, 'me', me, now()).catch(() => {})
}

/** 그 사용자의 내 정보 사본. 없거나 모양이 틀리면 없다. 기기 저장소를 쓸 수 없으면 DeviceUnavailable을 던진다. */
export async function readMeCopy(userId: string): Promise<Me | undefined> {
  const copy = await readCopy(userId, USER_SCOPE, 'me')
  return copy && parseMe(copy.data)
}

/** 그 사용자의 내 정보 사본(없으면 null). 사용자가 없으면 읽지 않는다. */
export function useMeCopy(userId: string | undefined) {
  return useQuery({
    queryKey: deviceKey(userId, 'me'),
    queryFn: async () => (await readMeCopy(userId!)) ?? null,
    enabled: userId !== undefined,
    staleTime: Infinity,
  })
}
