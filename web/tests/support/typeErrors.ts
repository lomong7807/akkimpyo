import ts from 'typescript'
import { webPath } from './webFile'

/** `src/`에 이 import 문과 JSX를 쓴 파일이 있다면 나올 타입 오류를 읽는다. 파일은 만들지 않는다. */
export function typeErrorsOf(imports: string, jsx: string): string[] {
  const fileName = webPath('src/TypeSample.tsx')
  const source = `${imports}\nexport const sample = <>${jsx}</>\n`
  const { config } = ts.readConfigFile(webPath('tsconfig.app.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent({ ...config, compilerOptions: { ...config.compilerOptions, noUnusedLocals: false } }, ts.sys, webPath('.'))
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
