import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/app/App'

vi.stubGlobal('scrollTo', vi.fn())

describe('App', () => {
  it('브라우저 주소에 맞는 화면을 그린다', () => {
    render(<App />)
    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('heading', { level: 1, name: '찾을 수 없어요.' })).toBeTruthy()
  })
})
