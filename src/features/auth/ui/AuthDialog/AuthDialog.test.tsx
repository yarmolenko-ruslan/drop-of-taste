import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AuthDialog } from './AuthDialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

test('проверяет телефон и согласие перед входом', async () => {
  const user = userEvent.setup()
  const onAuthenticate = vi.fn()
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={onAuthenticate} />
    </MemoryRouter>,
  )

  await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '+7 123')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Введите номер телефона полностью')
  expect(onAuthenticate).not.toHaveBeenCalled()

  await user.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '+7 999 123-45-67')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(onAuthenticate).toHaveBeenCalledWith('+7 (999) 123-45-67')
})
