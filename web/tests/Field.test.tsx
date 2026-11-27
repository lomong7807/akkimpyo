import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Field from '../src/components/Field'

afterEach(cleanup)

describe('칸이 여럿인 묶음', () => {
  function renderGroup(error?: string) {
    render(
      <Field group label="종류" error={error}>
        {(control) => (
          <div role="radiogroup" aria-label="종류" aria-describedby={control['aria-describedby']}>
            칸들
          </div>
        )}
      </Field>,
    )
  }

  it('이름은 같은 모양의 글자이고 label이 아니다. 이을 칸이 하나가 아니다', () => {
    renderGroup()
    const name = screen.getByText('종류')
    expect(name.tagName).toBe('SPAN')
    expect(getComputedStyle(name).font).toBe('var(--text-label)')
    expect(document.querySelector('label')).toBeNull()
  })

  it('오류 문구를 묶음에 잇는다', () => {
    renderGroup('종류를 골라 주세요.')
    const described = document.getElementById(screen.getByRole('radiogroup').getAttribute('aria-describedby')!)
    expect(described!.textContent).toBe('종류를 골라 주세요.')
  })
})
