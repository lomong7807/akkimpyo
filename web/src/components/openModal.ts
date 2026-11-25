/**
 * 열린 모달이 있는지. 키를 누르면 모달의 cancel보다 keydown이 먼저 오므로, 화면에서 키를 받는 곳은 이것을 먼저 본다.
 */
export function isModalOpen(): boolean {
  return document.querySelector('dialog[open]') !== null
}

/** 열린 모달이 모두 닫힌 뒤에 한 번 부른다. 열린 것이 없으면 바로 부른다. 돌려받은 함수로 그만둔다. */
export function afterModals(callback: () => void): () => void {
  if (!isModalOpen()) {
    callback()
    return () => {}
  }
  const observer = new MutationObserver(() => {
    if (isModalOpen()) return
    observer.disconnect()
    callback()
  })
  observer.observe(document.body, { subtree: true, childList: true, attributeFilter: ['open'] })
  return () => observer.disconnect()
}
