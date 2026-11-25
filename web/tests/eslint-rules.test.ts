// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { webPath } from './support/webFile'

async function ruleIdsFor(code: string, path = 'src/Sample.tsx'): Promise<(string | null)[]> {
  const eslint = new ESLint({ cwd: webPath('.') })
  const [result] = await eslint.lintText(code, { filePath: webPath(path) })
  return result.messages.map((message) => message.ruleId)
}

describe('ESLint', () => {
  it.each([
    ['속성', `export const a = <div dangerouslySetInnerHTML={{ __html: 'x' }} />`],
    ['펼친 객체', `export const a = <div {...{ dangerouslySetInnerHTML: { __html: 'x' } }} />`],
    ['펼친 객체(따옴표 이름)', `export const a = <div {...{ 'dangerouslySetInnerHTML': { __html: 'x' } }} />`],
  ])('JSX의 dangerouslySetInnerHTML을 막는다: %s', async (_, code) => {
    expect(await ruleIdsFor(code)).toEqual(['no-restricted-syntax'])
  })

  it('평범한 JSX는 막지 않는다', async () => {
    expect(await ruleIdsFor(`export const a = <div className="a">아낌표</div>`)).toEqual([])
  })
})

describe('의존 방향: app → features → components, api', () => {
  const feature = 'src/features/sample/sample.ts'
  const component = 'src/components/sample.ts'
  const nestedComponent = 'src/components/sample/sample.ts'
  const api = 'src/api/sample.ts'

  const value = (from: string) => `import { a } from '${from}'\nexport const b = a`
  const type = (from: string) => `import type { A } from '${from}'\nexport type B = A`
  const reExport = (from: string) => `export { a } from '${from}'`

  it.each([
    ['features에서 app', feature, value('../../app/routes')],
    ['features에서 app의 타입', feature, type('../../app/navigation')],
    ['features에서 app 다시 내보내기', feature, reExport('../../app/routes')],
    ['features에서 app 폴더', feature, value('../../app')],
    ['components에서 app', component, value('../app/routes')],
    ['components에서 app의 타입', component, type('../app/navigation')],
    ['components 안쪽 폴더에서 app', nestedComponent, value('../../app/routes')],
    ['components에서 features', component, value('../features/not-found/NotFoundPage')],
    ['components에서 features의 타입', component, type('../features/not-found/NotFoundPage')],
    ['components 안쪽 폴더에서 features', nestedComponent, reExport('../../features/not-found/NotFoundPage')],
    ['components에서 api', component, value('../api/request')],
    ['components에서 api의 타입', component, type('../api/apiError')],
    ['components 안쪽 폴더에서 api', nestedComponent, reExport('../../api/request')],
    ['api에서 app', api, value('../app/routes')],
    ['api에서 features', api, value('../features/auth/useLogin')],
    ['api에서 components', api, value('../components/Button')],
    ['api에서 React', api, value('react')],
    ['api에서 React의 타입', api, type('react')],
    ['api에서 React DOM', api, value('react-dom/client')],
    ['api에서 라우터', api, value('react-router/dom')],
    ['api에서 TanStack Query', api, value('@tanstack/react-query')],
    ['앱 코드에서 msw', feature, value('msw')],
    ['api에서 msw', api, value('msw/node')],
    ['components에서 msw', component, value('msw')],
    ['app에서 msw', 'src/app/sample.ts', value('msw/node')],
    ['main에서 msw', 'src/main.ts', value('msw/browser')],
  ])('막는다: %s', async (_, path, code) => {
    expect(await ruleIdsFor(code, path)).toEqual(['no-restricted-imports'])
  })

  it.each([
    ['features에서 components', feature, value('../../components/Button')],
    ['features에서 다른 기능', feature, value('../not-found/NotFoundPage')],
    ['features에서 패키지', feature, value('some-package/app')],
    ['components에서 components', component, value('./Icon')],
    ['app에서 features', 'src/app/sample.ts', value('../features/not-found/NotFoundPage')],
    ['app에서 components', 'src/app/sample.ts', value('../components/Button')],
    ['app에서 app', 'src/app/sample.ts', value('./navigation')],
    ['main에서 app', 'src/main.ts', value('./app/App')],
    ['features에서 api', feature, value('../../api/request')],
    ['app에서 api', 'src/app/sample.ts', value('../api/session')],
    ['main에서 api', 'src/main.ts', value('./api/session')],
    ['api에서 api', api, value('./http')],
    ['테스트에서 api', 'tests/sample.test.ts', value('../src/api/session')],
    ['테스트에서 msw', 'tests/sample.test.ts', value('msw/node')],
    ['테스트에서 app', 'tests/sample.test.ts', value('../src/app/routes')],
  ])('막지 않는다: %s', async (_, path, code) => {
    expect(await ruleIdsFor(code, path)).toEqual([])
  })
})
