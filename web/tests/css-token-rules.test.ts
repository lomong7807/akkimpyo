import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findTokenViolations } from './support/cssTokenRules'
import { readWebFile, webPath } from './support/webFile'

const found = (css: string) => findTokenViolations(css).map((violation) => violation.value)

describe('토큰 밖 값 검사기', () => {
  it.each([
    ['hex 색', 'a { color: #0F7B5F; }', '#0F7B5F'],
    ['짧은 hex 색', 'a { border: 1px solid #fff }', '#fff'],
    ['rgb 색', 'a { background: rgb(15 18 20 / 40%); }', 'rgb('],
    ['rgba 색', 'a { box-shadow: 0 0 4px rgba(0, 0, 0, 0.5); }', 'rgba('],
    ['hsl 색', 'a { color: hsl(160 78% 27%); }', 'hsl('],
    ['oklch 색', 'a { color: oklch(0.5 0.1 160); }', 'oklch('],
    ['색 섞기', 'a { color: color-mix(in srgb, var(--color-accent) 50%, transparent); }', 'color-mix('],
    ['색 이름', 'a { color: white; }', 'white'],
    ['대문자 색 이름', 'a { color: Red; }', 'Red'],
    ['여러 값 속의 색 이름', 'a { border: 1px solid gray; }', 'gray'],
    ['시스템 색 이름', 'a { color: CanvasText; }', 'CanvasText'],
    ['사용자 변수에 둔 색', 'a { --mine: #123456; }', '#123456'],
    ['중첩 규칙 속 색', '.a { &:hover { color: tomato; } }', 'tomato'],
    ['미디어 조건 속 색', '@media (prefers-color-scheme: dark) { a { color: #000; } }', '#000'],
    ['척도에 없는 px', 'a { padding: 10px; }', '10px'],
    ['여러 값 속의 px', 'a { padding: 8px 18px; }', '18px'],
    ['소수 px', 'a { padding: 0.5px; }', '0.5px'],
    ['2px', 'a { outline: 2px solid var(--color-accent); }', '2px'],
    ['음수 px', 'a { margin: -6px; }', '-6px'],
    ['계산 속 px', 'a { height: calc(100% - 56px); }', '56px'],
    ['rem으로 쓴 척도 밖 값', 'a { padding: 0.625rem; }', '0.625rem'],
    ['문서에 없는 화면 폭', '@media (min-width: 600px) { a { margin: 0; } }', '600px'],
  ])('%s을 찾는다', (_, css, value) => {
    expect(found(css)).toEqual([value])
  })

  it.each([
    ['토큰', 'a { color: var(--color-accent); padding: var(--space-16); }'],
    ['척도 값', 'a { padding: 4px 8px 12px 16px; margin: 24px 32px 40px; }'],
    ['음수 척도 값', 'a { margin: -16px; }'],
    ['1px 선과 0', 'a { border: 1px solid var(--color-border); margin: 0 0px; }'],
    ['색이 아닌 색 키워드', 'a { color: currentColor; background: transparent; fill: inherit; }'],
    ['색 이름이 들어간 변수와 선택자', '#add .red { color: var(--color-red); grid-area: red-area; }'],
    ['주석, 글자, 주소', '/* #fff 10px red */ a { content: "#fff 10px"; background: url(red-10px.svg#fff); }'],
    ['색 이름과 같은 수학 함수', 'a { rotate: calc(tan(45deg) * 1deg); }'],
    ['문서의 화면 폭', '@media (width >= 768px) and (width < 1024px) { a { margin: 0; } }'],
  ])('%s은 허용한다', (_, css) => {
    expect(found(css)).toEqual([])
  })

  it('어긋난 값의 줄 번호를 알려 준다', () => {
    expect(findTokenViolations('a {\n  margin: 0;\n  color: red;\n}')).toEqual([
      expect.objectContaining({ line: 3, value: 'red' }),
    ])
  })
})

describe('web/src의 CSS', () => {
  const files = globSync('src/**/*.css', { cwd: webPath('.') }).sort()
  const checked = files.filter((file) => file !== 'src/styles/tokens.css')

  it('tokens.css가 있고 나머지 CSS를 실제로 검사한다', () => {
    expect(files).toContain('src/styles/tokens.css')
    expect(checked).toContain('src/styles/base.css')
  })

  it('tokens.css 밖에는 색 리터럴과 척도에 없는 px 값이 없다', () => {
    const violations = checked.flatMap((file) =>
      findTokenViolations(readWebFile(file)).map(({ line, value }) => `${file}:${line} ${value}`),
    )
    expect(violations).toEqual([])
  })
})
