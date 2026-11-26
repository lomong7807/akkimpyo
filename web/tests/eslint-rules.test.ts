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

describe('의존 방향: app → features → components, api → device, 그리고 lib', () => {
  const feature = 'src/features/sample/sample.ts'
  const component = 'src/components/sample.ts'
  const nestedComponent = 'src/components/sample/sample.ts'
  const api = 'src/api/sample.ts'
  const lib = 'src/lib/sample.ts'
  const nestedLib = 'src/lib/sample/sample.ts'
  const device = 'src/device/sample.ts'
  const app = 'src/app/sample.ts'

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
    ['features에서 api의 http', feature, value('../../api/http')],
    ['features에서 api의 http의 타입', feature, type('../../api/http')],
    ['features에서 api의 authApi', feature, value('../../api/authApi')],
    ['features에서 api의 authApi의 타입', feature, type('../../api/authApi')],
    ['features에서 api의 sessionLock', feature, value('../../api/sessionLock')],
    ['features에서 api의 sessionLock 다시 내보내기', feature, reExport('../../api/sessionLock')],
    ['features에서 확장자를 적은 api의 http', feature, value('../../api/http.ts')],
    ['features에서 이름이 비슷한 api 모듈', feature, value('../../api/sessionStore')],
    ['features에서 api 폴더', feature, value('../../api')],
    ['features 안쪽 폴더에서 api의 http', 'src/features/sample/deep/sample.ts', value('../../../api/http')],
    ['앱 코드에서 msw', feature, value('msw')],
    ['api에서 msw', api, value('msw/node')],
    ['components에서 msw', component, value('msw')],
    ['app에서 msw', 'src/app/sample.ts', value('msw/node')],
    ['main에서 msw', 'src/main.ts', value('msw/browser')],
    ['lib에서 app', lib, value('../app/routes')],
    ['lib에서 app의 타입', lib, type('../app/navigation')],
    ['lib에서 features', lib, value('../features/accounts/accountForm')],
    ['lib에서 features 다시 내보내기', lib, reExport('../features/accounts/accountForm')],
    ['lib에서 components', lib, value('../components/Button')],
    ['lib에서 components의 타입', lib, type('../components/useFormFields')],
    ['lib에서 api', lib, value('../api/request')],
    ['lib에서 api의 타입', lib, type('../api/apiError')],
    ['lib 안쪽 폴더에서 components', nestedLib, value('../../components/Button')],
    ['lib 안쪽 폴더에서 api', nestedLib, reExport('../../api/request')],
    ['lib에서 React', lib, value('react')],
    ['lib에서 React의 타입', lib, type('react')],
    ['lib에서 React의 JSX 런타임', lib, value('react/jsx-runtime')],
    ['lib에서 React DOM', lib, value('react-dom/client')],
    ['lib에서 라우터', lib, value('react-router')],
    ['lib에서 TanStack Query', lib, value('@tanstack/react-query')],
    ['lib에서 다른 TanStack 패키지', lib, value('@tanstack/query-core')],
    ['lib에서 msw', lib, value('msw')],
    ['lib에서 device', lib, value('../device/copies')],
    ['device에서 app', device, value('../app/routes')],
    ['device에서 features', device, value('../features/me/me')],
    ['device에서 features의 타입', device, type('../features/me/me')],
    ['device에서 components', device, value('../components/Button')],
    ['device에서 api', device, value('../api/session')],
    ['device에서 api의 타입', device, type('../api/apiError')],
    ['device에서 React', device, value('react')],
    ['device에서 TanStack Query', device, value('@tanstack/react-query')],
    ['device에서 msw', device, value('msw')],
    ['components에서 device', component, value('../device/copies')],
    ['components 안쪽 폴더에서 device', nestedComponent, type('../../device/loginRecord')],
    ['features에서 device의 deviceDb', feature, value('../../device/deviceDb')],
    ['features에서 확장자를 적은 device의 deviceDb', feature, value('../../device/deviceDb.ts')],
    ['features에서 device의 deviceDb 다시 내보내기', feature, reExport('../../device/deviceDb')],
    ['app에서 device의 deviceDb', app, value('../device/deviceDb')],
    ['api에서 device의 deviceDb', api, value('../device/deviceDb')],
    ['main에서 device의 deviceDb', 'src/main.ts', value('./device/deviceDb')],
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
    ['features에서 api의 request', feature, value('../../api/request')],
    ['features에서 api의 session', feature, value('../../api/session')],
    ['features에서 api의 apiError', feature, value('../../api/apiError')],
    ['features에서 api의 apiError의 타입', feature, type('../../api/apiError')],
    ['features에서 확장자를 적은 api의 request', feature, value('../../api/request.ts')],
    ['features 안쪽 폴더에서 api의 session', 'src/features/sample/deep/sample.ts', value('../../../api/session')],
    ['app에서 api', 'src/app/sample.ts', value('../api/session')],
    ['main에서 api', 'src/main.ts', value('./api/session')],
    ['api에서 api', api, value('./http')],
    ['테스트에서 api', 'tests/sample.test.ts', value('../src/api/session')],
    ['테스트에서 msw', 'tests/sample.test.ts', value('msw/node')],
    ['테스트에서 app', 'tests/sample.test.ts', value('../src/app/routes')],
    ['lib에서 lib', lib, value('./trimEnds')],
    ['lib 안쪽 폴더에서 lib', nestedLib, value('../trimEnds')],
    ['app에서 lib', 'src/app/sample.ts', value('../lib/calendarDate')],
    ['features에서 lib', feature, value('../../lib/calendarDate')],
    ['features 안쪽 폴더에서 lib', 'src/features/sample/deep/sample.ts', value('../../../lib/visibleText')],
    ['components에서 lib', component, value('../lib/amountText')],
    ['components 안쪽 폴더에서 lib', nestedComponent, type('../../lib/calendarDate')],
    ['테스트에서 lib', 'tests/sample.test.ts', value('../src/lib/calendarDate')],
    ['api에서 device', api, value('../device/loginRecord')],
    ['features에서 device', feature, value('../../device/copies')],
    ['features 안쪽 폴더에서 device', 'src/features/sample/deep/sample.ts', type('../../../device/copies')],
    ['app에서 device', app, value('../device/userData')],
    ['device에서 device', device, value('./deviceDb')],
    ['device에서 lib', device, value('../lib/clock')],
    ['테스트에서 device의 deviceDb', 'tests/sample.test.ts', value('../src/device/deviceDb')],
  ])('막지 않는다: %s', async (_, path, code) => {
    expect(await ruleIdsFor(code, path)).toEqual([])
  })
})
