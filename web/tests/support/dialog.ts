/**
 * jsdom에 없는 `<dialog>`의 showModal과 close를 규격의 순서대로 흉내 낸다.
 * 초점을 가두는 것과 뒤 화면을 누를 수 없는 것은 흉내 내지 않는다. 실제 브라우저에서 확인한다.
 */
const opened: { dialog: HTMLDialogElement; opener: Element | null }[] = []

export function installDialog(): void {
  HTMLDialogElement.prototype.showModal = function () {
    if (this.open) throw new DOMException('이미 열려 있음', 'InvalidStateError')
    opened.push({ dialog: this, opener: document.activeElement })
    this.open = true
    this.querySelector<HTMLElement>('button, input, [tabindex="0"]')?.focus()
  }

  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return
    this.open = false
    const index = opened.findIndex(({ dialog }) => dialog === this)
    const [entry] = index < 0 ? [] : opened.splice(index, 1)
    if (entry?.opener instanceof HTMLElement) entry.opener.focus()
    queueMicrotask(() => this.dispatchEvent(new Event('close')))
  }

  document.addEventListener('keydown', (event) => {
    const top = opened.at(-1)?.dialog
    if (event.key !== 'Escape' || event.defaultPrevented || !top) return
    if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close()
  })
}
