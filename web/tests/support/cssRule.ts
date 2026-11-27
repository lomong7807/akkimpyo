import { readWebFile } from './webFile'

/**
 * CSS 파일에서 선택자가 `selector`인 첫 규칙의 선언을 글자 그대로 읽는다.
 * jsdom이 계산하지 못하는 값(env(), :active 같은 상태)을 확인할 때만 쓴다.
 */
export function readCssRule(path: string, selector: string): string {
  const css = readWebFile(path)
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${path}에 ${selector} 규칙이 없다`)
  return css.slice(start, css.indexOf('}', start)).replace(/\s+/g, ' ')
}
