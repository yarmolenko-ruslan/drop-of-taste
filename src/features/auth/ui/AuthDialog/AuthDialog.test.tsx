import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { ApiError } from '../../api/authApi'
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
  requestCode.mockResolvedValue({
    status: 'accepted',
    retryAfterSeconds: 60,
    developmentCode: '123456',
  })
  verifyCode.mockResolvedValue({ user: { id: 'u1', phone: '+79991234567', name: '' } })
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={onAuthenticate} />
    </MemoryRouter>,
  )

  expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  await user.clear(screen.getByRole('textbox', { name: 'Номер телефона' }))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '9991234567')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(onAuthenticate).not.toHaveBeenCalled()
  await screen.findByRole('textbox', { name: 'Одноразовый код' })
  expect(requestCode).toHaveBeenCalledWith('+79991234567', expect.any(AbortSignal))
  expect(screen.getByText(/Введите код для номера/)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Код подтверждения: 123456')
  await user.type(screen.getByRole('textbox', { name: 'Одноразовый код' }), '123456')
  await user.click(screen.getByRole('button', { name: 'Войти' }))
  expect(verifyCode).toHaveBeenCalledWith('+79991234567', '123456', true, expect.any(AbortSignal))
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
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '999123')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Введите российский мобильный номер полностью',
  )
  expect(requestCode).not.toHaveBeenCalled()
})

test('при нажатии на поле открывает скобку и продолжает маску номера', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={() => {}} />
    </MemoryRouter>,
  )
  const input = screen.getByRole('textbox', { name: 'Номер телефона' })
  expect(input).toHaveValue('+7')
  await user.click(input)
  expect(input).toHaveValue('+7 (')
  await user.type(input, '9991234567')
  expect(input).toHaveValue('+7 (999) 123-45-67')
})

test('бэкспейс стирает номер полностью до +7, без остановки на скобках', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={() => {}} />
    </MemoryRouter>,
  )
  const input = screen.getByRole('textbox', { name: 'Номер телефона' })
  await user.type(input, '9991234567')
  expect(input).toHaveValue('+7 (999) 123-45-67')
  await user.type(input, '{backspace}'.repeat(16))
  expect(input).toHaveValue('+7')
  await user.type(input, '{backspace}')
  expect(input).toHaveValue('+7')
})

test('при лимите запроса кода показывает оставшееся время', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <AuthDialog onClose={() => {}} onAuthenticate={() => {}} />
    </MemoryRouter>,
  )
  requestCode.mockRejectedValue(
    Object.assign(new ApiError('RATE_LIMITED', 'Повторите запрос позже'), {
      retryAfterSeconds: 45,
    }),
  )
  await user.click(screen.getByRole('checkbox'))
  await user.type(screen.getByRole('textbox', { name: 'Номер телефона' }), '9991234567')
  await user.click(screen.getByRole('button', { name: 'Продолжить' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(/Повторный запрос кода возможен через \d+ с/)
  expect(alert).not.toHaveTextContent('Повторите запрос позже')
})
