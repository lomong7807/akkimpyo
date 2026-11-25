import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// 의존 방향은 app → features → components다. 거꾸로 불러오지 않는다.
function importsFrom(folder) {
  return {
    regex: `^\\.\\.?/(.*/)?${folder}(/|$)`,
    message: `의존 방향은 app → features → components다. 여기서 ${folder}를 불러오지 않는다.`,
  }
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
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [importsFrom('app')] }] },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [importsFrom('app'), importsFrom('features')] }] },
  },
)
