import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// 의존 방향은 app → features → components, api다. 거꾸로 불러오지 않고 components와 api는 서로 모른다.
// lib는 화면과 무관한 계산이다. React와 앱의 다른 폴더를 모른다.
// device는 기기 저장소(IndexedDB, #234)다. lib만 부르고 app, features, api가 device를 부른다. IndexedDB를 직접 다루는
// deviceDb는 device 안에서만 부른다(architect 결정, #102).
// sw는 service worker(#234 C)다. 앱과 따로 묶이므로 sw 밖을 부르지 않는다.
const direction = '의존 방향은 app → features → components, api다.'
const libDirection = 'lib는 화면과 무관한 계산이라 앱의 다른 폴더를 모른다.'
const deviceDirection = 'device는 기기 저장소라 lib만 부른다.'
const swDirection = 'service worker는 따로 묶이는 classic script라 sw 밖을 부르지 않는다.'

function importsFrom(folder, rule = direction) {
  return {
    regex: `^\\.\\.?/(.*/)?${folder}(/|$)`,
    message: `${rule} 여기서 ${folder}를 불러오지 않는다.`,
  }
}

const reactPackages = {
  regex: '^(react|react-dom|react-router|@tanstack/react-query)(/|$)',
  message: 'api는 React와 무관하다. 화면과 잇는 훅은 features에 둔다.',
}

const libPackages = {
  regex: '^((react|react-dom|react-router)(/|$)|@tanstack/)',
  message: 'lib는 React와 무관하다. 화면과 잇는 코드는 components나 features에 둔다.',
}

const apiInternals = {
  regex: '^\\.\\.?/(.*/)?api(/(?!(request|session|apiError|connection)(\\.ts)?$)|$)',
  message: '화면은 api의 request, session, apiError, connection만 쓴다. 나머지는 api 안의 구현이다.',
}

// 화면은 연결 상태를 읽기만 한다. 상태는 api 안의 요청 결과(http)와 앱 시작(app)이 바꾼다(4.3, architect #234 B).
const connectionWrites = {
  regex: '^\\.\\.?/(.*/)?api/connection(\\.ts)?$',
  allowImportNames: ['connection', 'onConnectionChange', 'Connection'],
  message: '화면은 api의 connection에서 connection, onConnectionChange, Connection만 쓴다. 연결 상태는 api가 바꾼다.',
}

const deviceInternals = {
  regex: '^\\.\\.?/(.*/)?device/deviceDb(\\.ts)?$',
  message: 'deviceDb는 device 안에서만 쓴다. 저장소마다 있는 device 모듈을 부른다.',
}

const devicePackages = {
  regex: '^((react|react-dom|react-router)(/|$)|@tanstack/)',
  message: 'device는 React와 무관하다. 화면과 잇는 훅은 features에 둔다.',
}

const anyPackage = {
  regex: '^[^./]',
  message: `${swDirection} 패키지도 부르지 않는다.`,
}

const mswPackage = {
  regex: '^msw(/|$)',
  message: '가짜 응답은 테스트에서만 쓴다.',
}

/** 파일마다 마지막에 맞는 설정 하나만 걸리므로 앱 코드 전체의 규칙을 폴더마다 함께 적는다. */
function restrictedImports(files, patterns = []) {
  return { files, rules: { 'no-restricted-imports': ['error', { patterns: [mswPackage, ...patterns] }] } }
}

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='dangerouslySetInnerHTML'], Property[key.name='dangerouslySetInnerHTML'], Property[key.value='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML은 쓰지 않는다(XSS). 글자와 요소는 JSX로 그린다.',
        },
      ],
    },
  },
  restrictedImports(['src/**/*.{ts,tsx}'], [deviceInternals]),
  restrictedImports(['src/features/**/*.{ts,tsx}'], [importsFrom('app'), apiInternals, connectionWrites, deviceInternals]),
  restrictedImports(
    ['src/components/**/*.{ts,tsx}'],
    [importsFrom('app'), importsFrom('features'), importsFrom('api'), importsFrom('device')],
  ),
  restrictedImports(
    ['src/api/**/*.{ts,tsx}'],
    [importsFrom('app'), importsFrom('features'), importsFrom('components'), reactPackages, deviceInternals],
  ),
  restrictedImports(
    ['src/device/**/*.{ts,tsx}'],
    [
      importsFrom('app', deviceDirection),
      importsFrom('features', deviceDirection),
      importsFrom('components', deviceDirection),
      importsFrom('api', deviceDirection),
      devicePackages,
    ],
  ),
  restrictedImports(
    ['src/sw/**/*.{ts,tsx}'],
    ['app', 'features', 'components', 'api', 'device', 'lib'].map((folder) => importsFrom(folder, swDirection)).concat(anyPackage),
  ),
  { files: ['src/sw/**/*.{ts,tsx}'], languageOptions: { globals: globals.serviceworker } },
  restrictedImports(
    ['src/lib/**/*.{ts,tsx}'],
    [
      importsFrom('app', libDirection),
      importsFrom('features', libDirection),
      importsFrom('components', libDirection),
      importsFrom('api', libDirection),
      importsFrom('device', libDirection),
      libPackages,
    ],
  ),
)
