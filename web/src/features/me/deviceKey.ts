/**
 * 기기 저장소(#234)에서 읽은 값의 캐시 키 앞부분. 서버 데이터의 키(ledgerKey)와 섞이지 않는다.
 * 로그인마다 새로 만드는 캐시(SignedInArea)에 들어가므로 앞 사용자의 것이 남지 않는다.
 */
export function deviceKey(userId: string | undefined, ...parts: string[]) {
  return ['device', userId ?? '', ...parts] as const
}
