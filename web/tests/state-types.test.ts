// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const imports = `
import EmptyState from './components/EmptyState'
import LoadFailure from './components/LoadFailure'
import Skeleton, { SkeletonBar } from './components/Skeleton'
`
const typeErrors = (jsx: string) => typeErrorsOf(imports, jsx)

describe('뼈대, 빈 상태, 오류 상태의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <Skeleton><SkeletonBar kind="name" text="label" /><SkeletonBar kind="amount" text="title" /></Skeleton>
        <EmptyState description="없어요." />
        <LoadFailure headingLevel={2} onRetry={() => {}} />
        <LoadFailure onRetry={() => {}} busy />
      `),
    ).toEqual([])
  })

  it.each([
    ['뼈대의 className', '<Skeleton className="a">{null}</Skeleton>', 'className'],
    ['뼈대의 style', '<Skeleton style={{ margin: 0 }}>{null}</Skeleton>', 'style'],
    ['막대의 className', '<SkeletonBar kind="name" text="body" className="a" />', 'className'],
    ['막대의 style', '<SkeletonBar kind="name" text="body" style={{ width: 1 }} />', 'style'],
    ['막대의 없는 글자', '<SkeletonBar kind="name" text="hero" />', 'hero'],
    ['빈 상태의 className', '<EmptyState description="없어요." className="a" />', 'className'],
    ['빈 상태의 style', '<EmptyState description="없어요." style={{ margin: 0 }} />', 'style'],
    ['오류 상태의 className', '<LoadFailure onRetry={() => {}} className="a" />', 'className'],
    ['없는 제목 단계', '<LoadFailure headingLevel={3} onRetry={() => {}} />', '3'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
