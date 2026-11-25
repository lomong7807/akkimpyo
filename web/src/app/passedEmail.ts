/** 로그인과 가입 화면이 서로 넘긴 이메일. 방문 기록에서 온 값이므로 글자일 때만 쓴다. */
export function passedEmail(state: unknown): string {
  const email = (state as { email?: unknown } | null)?.email
  return typeof email === 'string' ? email : ''
}
