/**
 * 브라우저에 이 사이트의 저장을 지우지 말아 달라고 요청한다(ADR 006 결정 7). 이미 받아들여졌으면 다시 묻지 않는다.
 * Firefox는 권한 창을 띄우므로 로그인한 뒤에 부른다. 결과는 보이지 않는다. API가 없거나 실패해도 아무것도 하지 않는다.
 * iPhone 홈 화면 앱에서 받아들여지는지는 owner 시험(#72)으로 확인한다.
 */
export async function askToKeepStorage(): Promise<void> {
  try {
    const storage = navigator.storage
    if (typeof storage?.persist !== 'function' || typeof storage.persisted !== 'function') return
    if (await storage.persisted()) return
    await storage.persist()
  } catch {
    // 요청하지 못해도 기기 저장은 그대로 쓴다
  }
}
