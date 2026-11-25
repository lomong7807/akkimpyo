import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// 의존 방향은 app → features → components, api다. 거꾸로 불러오지 않고 components와 api는 서로 모른다.
function importsFrom(folder) {
  return {
    regex: `^\\.\\.?/(.*/)?${folder}(/|$)`,
    message: `의존 방향은 app → features → components, api다. 여기서 ${folder}를 불러오지 않는다.`,
  }
}

const reactPackages = {
  regex: '^(react|react-dom|react-router|@tanstack/react-query)(/|$)',
  message: 'api는 React와 무관하다. 화면과 잇는 훅은 features에 둔다.',
}

const apiInternals = {
  regex: '^\\.\\.?/(.*/)?api(/(?!(request|session|apiError)(\\.ts)?$)|$)',
  message: '화면은 api의 request, session, apiError만 쓴다. 나머지는 api 안의 구현이다.',
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
  restrictedImports(['src/**/*.{ts,tsx}']),
  restrictedImports(['src/features/**/*.{ts,tsx}'], [importsFrom('app'), apiInternals]),
  restrictedImports(
    ['src/components/**/*.{ts,tsx}'],
    [importsFrom('app'), importsFrom('features'), importsFrom('api')],
  ),
  restrictedImports(
    ['src/api/**/*.{ts,tsx}'],
    [importsFrom('app'), importsFrom('features'), importsFrom('components'), reactPackages],
  ),
)
