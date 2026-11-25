// @vitest-environment node
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { webPath } from './support/webFile'

/** `src/`에 이 JSX를 쓴 파일이 있다면 나올 타입 오류를 읽는다. 파일은 만들지 않는다. */
function typeErrors(jsx: string): string[] {
  const fileName = webPath('src/ButtonTypeSample.tsx')
  const source = `import { Button, ButtonLink } from './components/Button'\nexport const sample = <>${jsx}</>\nexport { Button, ButtonLink }\n`
  const { config } = ts.readConfigFile(webPath('tsconfig.app.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, webPath('.'))
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (name) => name === fileName || fileExists(name)
  host.readFile = (name) => (name === fileName ? source : readFile(name))
  host.getSourceFile = (name, ...rest) =>
    name === fileName ? ts.createSourceFile(name, source, rest[0]) : getSourceFile(name, ...rest)
  const program = ts.createProgram([fileName, webPath('node_modules/vite/client.d.ts')], options, host)
  return program
    .getSemanticDiagnostics(program.getSourceFile(fileName))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('버튼의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <Button kind="primary" onClick={() => {}} busy>저장</Button>
        <Button kind="icon" icon="X" aria-label="닫기" />
        <ButtonLink kind="text" to="/home">홈으로</ButtonLink>
      `),
    ).toEqual([])
  })

  it.each([
    ['이름 없는 아이콘 버튼', '<Button kind="icon" icon="X" />', 'aria-label'],
    ['이름 없는 아이콘 링크', '<ButtonLink kind="icon" icon="X" to="/home" />', 'aria-label'],
    ['글자 없는 버튼', '<Button kind="primary" />', 'children'],
    ['className으로 모양 덮어쓰기', '<Button kind="primary" className="a">저장</Button>', 'className'],
    ['style로 모양 덮어쓰기', '<Button kind="primary" style={{ margin: 0 }}>저장</Button>', 'style'],
    ['링크의 className', '<ButtonLink kind="primary" to="/" className="a">홈</ButtonLink>', 'className'],
    ['링크의 style', '<ButtonLink kind="primary" to="/" style={{ margin: 0 }}>홈</ButtonLink>', 'style'],
    ['없는 종류', '<Button kind="ghost">저장</Button>', 'ghost'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
