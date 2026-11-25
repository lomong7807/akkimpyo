// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const typeErrors = (jsx: string) => typeErrorsOf(`import SegmentedChoice from './components/SegmentedChoice'`, jsx)

const props = `label="구분" options={[{ value: 'A', label: '가' }]} value="A" onChange={() => {}}`

describe('유형 고르기의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <SegmentedChoice ${props} />
        <SegmentedChoice ${props} readOnly aria-describedby="a" ref={() => {}} />
      `),
    ).toEqual([])
  })

  it.each([
    ['className', `<SegmentedChoice ${props} className="a" />`, 'className'],
    ['style', `<SegmentedChoice ${props} style={{ margin: 0 }} />`, 'style'],
    ['비활성', `<SegmentedChoice ${props} disabled />`, 'disabled'],
    ['이름 없는 고르기', `<SegmentedChoice options={[]} value="A" onChange={() => {}} />`, 'label'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
