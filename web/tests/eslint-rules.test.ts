// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { webPath } from './support/webFile'

async function ruleIdsFor(code: string): Promise<(string | null)[]> {
  const eslint = new ESLint({ cwd: webPath('.') })
  const [result] = await eslint.lintText(code, { filePath: webPath('src/Sample.tsx') })
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
