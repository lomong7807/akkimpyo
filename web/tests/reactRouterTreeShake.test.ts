// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DISPLAY_NAMES, FORWARD_REFS, markUnusedRouterParts, TARGETS } from '../plugins/reactRouterTreeShake'

/*
 * react-router에서 앱이 쓰지 않는 부품을 번들러가 지울 수 있게 표시하는 빌드 플러그인(#355). 설치한 react-router의 그 파일에
 * 목록의 모양이 그대로 있어야 한다. react-router를 올려 모양이 바뀌면 이 테스트와 빌드가 함께 실패한다.
 */

const read = (target: string) => readFileSync(fileURLToPath(new URL(`..${target}`, import.meta.url)), 'utf8')
const installed = read(TARGETS[0])

describe('react-router 쓰지 않는 부품 표시', () => {
  it('설치한 판의 맨 위 forwardRef 셋에 PURE 표시를 붙이고 displayName 다섯 줄을 주석으로 만든다', () => {
    const marked = markUnusedRouterParts(installed)

    for (const name of FORWARD_REFS) expect(marked).toContain(`const ${name} = /* @__PURE__ */ React$1.forwardRef(`)
    for (const name of DISPLAY_NAMES) expect(marked).toMatch(new RegExp(`^/\\* ${name}\\.displayName = "[^"]*"; \\*/$`, 'm'))
    expect(marked).not.toMatch(/^\w+\.displayName = /m)
    // 함수 안에서 만드는 fetcher.Form의 이름은 그대로다
    expect(marked).toMatch(/^\t+FetcherForm\.displayName = "fetcher\.Form";$/m)
    expect(marked.split('\n')).toHaveLength(installed.split('\n').length)
  })

  it('development 판(NODE_ENV가 production이 아닌 빌드)도 같은 모양이다', () => {
    const marked = markUnusedRouterParts(read(TARGETS[1]))

    for (const name of FORWARD_REFS) expect(marked).toContain(`const ${name} = /* @__PURE__ */ React$1.forwardRef(`)
    expect(marked).not.toMatch(/^\w+\.displayName = /m)
  })

  it('목록에 없는 forwardRef가 생기면 던진다', () => {
    const changed = `${installed}\nconst Extra = React$1.forwardRef(() => null);\n`

    expect(() => markUnusedRouterParts(changed)).toThrow(/forwardRef.*Link, NavLink, Form, Extra.*Link, NavLink, Form/)
  })

  it('displayName 줄이 하나라도 없어지면 던진다', () => {
    const changed = installed.replace(/^ScrollRestoration\.displayName = "[^"]*";$/m, '')

    expect(() => markUnusedRouterParts(changed)).toThrow(/displayName.*HistoryRouter, Link, NavLink, Form\].*ScrollRestoration/)
  })
})
