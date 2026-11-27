import type { Plugin } from 'vite'

/*
 * react-router에서 앱이 쓰지 않는 부품이 첫 화면 JS에 남지 않게 하는 빌드 플러그인(#355, architect 조건 A).
 * react-router 8.5.2의 dist/production/lib/dom/lib.js(NODE_ENV가 production이 아닌 빌드는 dist/development의 같은 파일)는
 * 파일 맨 위에서 `const Link = React$1.forwardRef(...)`로 부품을 만들고 `Link.displayName = "Link";`를 적는다. forwardRef 호출에는 PURE 표시가 없고 displayName 대입은 속성 쓰기라, 번들러는
 * 앱이 쓰지 않는 부품(Form, react-router의 Link·NavLink와 Link가 끌어오는 prefetch 부품)도 지우지 못한다.
 * 이 플러그인은 그 파일 하나에서만 (1) 맨 위 forwardRef 호출 앞에 PURE 표시를 붙이고 (2) 맨 위 displayName 대입을 주석으로 만든다.
 * 쓰는 부품은 그대로 남아 동작이 같다. displayName은 개발 도구와 오류 글에 보이는 이름일 뿐이다.
 * 고친 곳의 이름이 아래 목록과 다르거나 그 파일을 보지 못하면 빌드를 멈춘다. 일부만 맞아 줄인 양이 조용히 사라지지 않게 한다.
 * react-router를 올리는 PR은 이 목록을 다시 맞춘다(useGoBack의 메모). 개발 서버와 vitest는 이 플러그인 없이 돈다(apply: 'build').
 * 되돌리기: vite.config.ts의 plugins에서 reactRouterTreeShake()를 지운다.
 */

/** 대상 파일. 빌드 조건에 따라 production이나 development 가운데 하나를 묶는다. 두 판의 모양은 같다 */
export const TARGETS = [
  '/node_modules/react-router/dist/production/lib/dom/lib.js',
  '/node_modules/react-router/dist/development/lib/dom/lib.js',
]

/** PURE 표시를 붙이는 맨 위 `const 이름 = React$1.forwardRef(`의 이름, 파일의 순서대로 */
export const FORWARD_REFS = ['Link', 'NavLink', 'Form']

/** 주석으로 만드는 맨 위 `이름.displayName = "…";` 줄의 이름, 파일의 순서대로. 함수 안의 대입(fetcher.Form)은 두지 않는다 */
export const DISPLAY_NAMES = ['HistoryRouter', 'Link', 'NavLink', 'Form', 'ScrollRestoration']

const FORWARD_REF = /^const (\w+) = (React\$1\.forwardRef\()/gm
const DISPLAY_NAME = /^(\w+)\.displayName = "[^"\n]*";$/gm

function assertSame(kind: string, found: string[], expected: string[]) {
  if (found.join() === expected.join()) return
  throw new Error(
    `react-router의 dist/*/lib/dom/lib.js에서 맨 위 ${kind}의 모양이 바뀌었다. 찾은 것 [${found.join(', ')}], ` +
      `기대한 것 [${expected.join(', ')}]. plugins/reactRouterTreeShake.ts의 목록을 새 판에 맞춰 다시 본다(#355).`,
  )
}

/** 대상 파일의 코드를 고친다. 줄 수는 그대로다. 모양이 목록과 다르면 던진다. */
export function markUnusedRouterParts(code: string): string {
  const forwardRefs: string[] = []
  const displayNames: string[] = []
  const marked = code
    .replace(FORWARD_REF, (_match, name: string, call: string) => {
      forwardRefs.push(name)
      return `const ${name} = /* @__PURE__ */ ${call}`
    })
    .replace(DISPLAY_NAME, (line, name: string) => {
      displayNames.push(name)
      return `/* ${line} */`
    })
  assertSame('forwardRef', forwardRefs, FORWARD_REFS)
  assertSame('displayName', displayNames, DISPLAY_NAMES)
  return marked
}

export function reactRouterTreeShake(): Plugin {
  let seen = false
  return {
    name: 'akkimpyo-react-router-tree-shake',
    apply: 'build',
    transform(code, id) {
      const file = id.split('?')[0].split('\\').join('/')
      if (!TARGETS.some((target) => file.endsWith(target))) return null
      seen = true
      try {
        // 줄 수와 다른 줄의 자리는 그대로라 소스 맵은 원래 것을 쓴다(null)
        return { code: markUnusedRouterParts(code), map: null }
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error))
      }
    },
    buildEnd(error) {
      if (!error && !seen) {
        this.error(`react-router의 dist/*/lib/dom/lib.js를 묶지 않았다. 경로가 바뀌었으면 plugins/reactRouterTreeShake.ts를 고친다(#355).`)
      }
    },
  }
}
