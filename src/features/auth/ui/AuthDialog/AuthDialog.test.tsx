import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AuthDialog } from './AuthDialog'

const requestCode = vi.fn()
const verifyCode = vi.fn()
vi.mock('../../api/authApi', () => ({
  authApi: {
    requestCode: (...args: unknown[]) => requestCode(...args),
    verifyCode: (...args: unknown[]) => verifyCode(...args),
  },
  ApiError: class extends Error {
    retryAfterSeconds = 0
  },
}))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  requestCode.mockReset()
  verifyCode.mockReset()
})

test('вход возможен только после согласия и верного кода', async () => {
  const user = userEvent.setup()
  const onAuthenticate = vi.fn()
  requestCode.mockResolvedValue({ status: 'accepted', retryAfterSeconds: 60 })
  verifyCode.mockResolvedValue({ user: { id: 'u1', phone: '+79991234567', name: '' } })
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={onAuthenticate} />
    </MemoryRouter>,
  )

  expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '+7 999 123-45-67')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(onAuthenticate).not.toHaveBeenCalled()
  await screen.findByRole('textbox', { name: 'Код из SMS' })
  expect(requestCode).toHaveBeenCalledWith('+79991234567')
  expect(screen.getByText(/SMS не отправляется/)).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Код из SMS' }), '123456')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  await waitFor(() =>
    expect(onAuthenticate).toHaveBeenCalledWith({ id: 'u1', phone: '+79991234567', name: '' }),
  )
})

test('неполный номер не отправляет запрос кода', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={() => {}} />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('checkbox'))
  await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '+7 999 123')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Введите российский мобильный номер полностью',
  )
  expect(requestCode).not.toHaveBeenCalled()
})
