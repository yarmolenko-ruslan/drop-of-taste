import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { Dialog } from './Dialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

test('клик внутри не закрывает окно, а фон, крестик и Escape вызывают закрытие', () => {
  const onClose = vi.fn()
  render(
    <Dialog titleId="test-title" onClose={onClose}>
      <h2 id="test-title">Блюдо</h2>
    </Dialog>,
  )

  const dialog = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('heading', { name: 'Блюдо' }))
  expect(onClose).not.toHaveBeenCalled()

  fireEvent.mouseDown(dialog)
  fireEvent.click(dialog)
  expect(onClose).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }))
  expect(onClose).toHaveBeenCalledTimes(2)

  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledTimes(3)
})

test('не закрывает окно, если мышь отпущена вне модалки после нажатия внутри', () => {
  const onClose = vi.fn()
  render(
    <Dialog titleId="drag-title" onClose={onClose}>
      <h2 id="drag-title">Блюдо</h2>
    </Dialog>,
  )

  const dialog = screen.getByRole('dialog')
  fireEvent.mouseDown(screen.getByRole('heading', { name: 'Блюдо' }))
  fireEvent.click(dialog)
  expect(onClose).not.toHaveBeenCalled()
})

test('ставит фокус на закрытие и возвращает его на исходную кнопку', () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()

  const { unmount } = render(
    <Dialog titleId="focus-title" onClose={() => {}}>
      <h2 id="focus-title">Блюдо</h2>
    </Dialog>,
  )
  expect(screen.getByRole('button', { name: 'Закрыть окно' })).toHaveFocus()

  unmount()
  expect(opener).toHaveFocus()
  opener.remove()
})

test('смена обработчика сохраняет фокус и использует актуальное закрытие', () => {
  const previous = vi.fn()
  const current = vi.fn()
  const contents = (
    <>
      <h2 id="stable-title">Адрес</h2>
      <input aria-label="Улица" />
    </>
  )
  const { rerender } = render(
    <Dialog titleId="stable-title" onClose={previous}>
      {contents}
    </Dialog>,
  )
  const field = screen.getByRole('textbox')
  field.focus()
  rerender(
    <Dialog titleId="stable-title" onClose={current}>
      {contents}
    </Dialog>,
  )
  expect(field).toHaveFocus()
  const dialog = screen.getByRole('dialog')
  fireEvent.mouseDown(dialog)
  fireEvent.click(dialog)
  expect(previous).not.toHaveBeenCalled()
  expect(current).toHaveBeenCalledOnce()
})
