import { afterEach } from 'vitest'

let observers: MutationObserver[] = []

afterEach(() => {
  observers.forEach((observer) => observer.disconnect())
  observers = []
})

/** 부른 뒤부터 화면에 더해진 것을 모두 모은다. 그리기 전에 다시 빠진 것도 남는다. */
export function recordDom() {
  const texts: string[] = []
  const elements: Element[] = []

  function collect(records: MutationRecord[]) {
    for (const { addedNodes, target, type } of records) {
      const nodes = type === 'characterData' ? [target] : [...addedNodes]
      for (const node of nodes) {
        texts.push(node.textContent ?? '')
        if (node instanceof Element) elements.push(node, ...node.querySelectorAll('*'))
      }
    }
  }

  const observer = new MutationObserver(collect)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  observers.push(observer)

  return {
    sawText(text: string): boolean {
      collect(observer.takeRecords())
      return texts.some((seen) => seen.includes(text))
    },
    sawElement(selector: string): boolean {
      collect(observer.takeRecords())
      return elements.some((element) => element.matches(selector))
    },
  }
}
