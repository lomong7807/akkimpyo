import { transact, userRange } from './deviceDb'

/**
 * 그 사용자의 기기 데이터(읽기용 사본, 보내지 않은 입력, 쓰던 값)를 한 트랜잭션으로 지운다(로그아웃, F-016).
 * 마지막으로 쓴 계좌 기본값은 localStorage에 있어 건드리지 않는다. 로그인 기록은 로그아웃이 먼저 따로 지운다.
 */
export function forgetUserData(userId: string): Promise<void> {
  return transact(
    ['copies', 'queue', 'drafts'],
    'readwrite',
    (transaction) => {
      const range = userRange(userId)
      for (const store of ['copies', 'queue', 'drafts'] as const) transaction.objectStore(store).delete(range)
    },
    { durability: 'strict' },
  )
}
