import ts from 'typescript'
import { webPath } from './webFile'

const fileName = webPath('src/TypeSample.tsx')

/** tsconfig.app.json의 설정. 읽고 푸는 데 시간이 들어 한 번만 한다. */
let options: ts.CompilerOptions | undefined

/**
 * 시험하는 동안 바뀌지 않는 파일(src/, 타입 정의)의 구문 트리. 부를 때마다 다시 읽고 다시 파싱하지 않게 한 테스트 파일 안에서 나눠 쓴다.
 * TypeScript의 언어 서비스도 같은 방식으로 프로그램 사이에 트리를 나눠 쓴다.
 */
const sourceFiles = new Map<string, ts.SourceFile>()

/** 앞서 만든 프로그램. 파일 구성과 모듈 해석을 이어 받는다. */
let previous: ts.Program | undefined

function compilerOptions(): ts.CompilerOptions {
  if (!options) {
    const { config } = ts.readConfigFile(webPath('tsconfig.app.json'), ts.sys.readFile)
    options = ts.parseJsonConfigFileContent(
      { ...config, compilerOptions: { ...config.compilerOptions, noUnusedLocals: false } },
      ts.sys,
      webPath('.'),
    ).options
  }
  return options
}

/** `src/`에 이 import 문과 JSX를 쓴 파일이 있다면 나올 타입 오류를 읽는다. 파일은 만들지 않는다. */
export function typeErrorsOf(imports: string, jsx: string): string[] {
  const source = `${imports}\nexport const sample = <>${jsx}</>\n`
  const options = compilerOptions()
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (name) => name === fileName || fileExists(name)
  host.readFile = (name) => (name === fileName ? source : readFile(name))
  host.getSourceFile = (name, ...rest) => {
    if (name === fileName) return ts.createSourceFile(name, source, rest[0])
    const cached = sourceFiles.get(name)
    if (cached) return cached
    const file = getSourceFile(name, ...rest)
    if (file) sourceFiles.set(name, file)
    return file
  }
  const program = ts.createProgram({
    rootNames: [fileName, webPath('node_modules/vite/client.d.ts')],
    options,
    host,
    oldProgram: previous,
  })
  previous = program
  return program
    .getSemanticDiagnostics(program.getSourceFile(fileName))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}
