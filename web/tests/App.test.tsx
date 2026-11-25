import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/app/App'
import { startBackend } from './support/backend'
import { startMockServer } from './support/mockServer'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()

afterEach(cleanup)

describe('App', () => {
  it('브라우저 주소에 맞는 화면을 그린다', async () => {
    startBackend(server)
    expect(window.location.pathname).toBe('/')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    expect(window.location.pathname).toBe('/login')
  })
})
