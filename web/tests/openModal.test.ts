import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterModals, isModalOpen } from '../src/components/openModal'

afterEach(() => document.body.replaceChildren())

function openDialog() {
  const dialog = document.createElement('dialog')
  document.body.append(dialog)
  dialog.showModal()
  return dialog
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('열린 모달이 있는지', () => {
  it('없거나 닫혔으면 아니다', () => {
    expect(isModalOpen()).toBe(false)
    const dialog = openDialog()
    expect(isModalOpen()).toBe(true)
    dialog.close()
    expect(isModalOpen()).toBe(false)
  })
})

describe('열린 모달이 닫힌 뒤', () => {
  it('열린 것이 없으면 바로 부른다', () => {
    const callback = vi.fn()
    afterModals(callback)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['닫히면', (dialog: HTMLDialogElement) => dialog.close()],
    ['화면에서 빠지면', (dialog: HTMLDialogElement) => dialog.remove()],
  ])('%s 한 번 부른다', async (_, close) => {
    const callback = vi.fn()
    const dialog = openDialog()
    afterModals(callback)
    await settle()
    expect(callback).not.toHaveBeenCalled()
    close(dialog)
    await settle()
    expect(callback).toHaveBeenCalledTimes(1)
    openDialog().close()
    await settle()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('여럿이면 모두 닫힌 뒤다', async () => {
    const callback = vi.fn()
    const [first, second] = [openDialog(), openDialog()]
    afterModals(callback)
    second.close()
    await settle()
    expect(callback).not.toHaveBeenCalled()
    first.close()
    await settle()
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
