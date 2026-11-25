import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../src/App'

describe('App', () => {
  it('화면 제목으로 앱 이름 "아낌표"를 보여 준다', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: '아낌표' })).toBeTruthy()
  })
})
