import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthDialog } from './AuthDialog'

const startCall = vi.fn()
const checkCall = vi.fn()
vi.mock('../../api/authApi', () => ({
  authApi: {
    startCall: (...args: unknown[]) => startCall(...args),
    checkCall: (...args: unknown[]) => checkCall(...args),
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
  vi.useFakeTimers()
  startCall.mockReset().mockResolvedValue({
    status: 'accepted',
    attemptToken: 'A'.repeat(43),
    callPhone: '+78005008275',
    expiresAt: Date.now() + 300000,
    retryAfterSeconds: 60,
  })
  checkCall.mockReset().mockResolvedValue({ status: 'waiting', pollAfterSeconds: 3 })
})
afterEach(() => vi.useRealTimers())

function mount(onAuthenticate = vi.fn()) {
  return render(
    <MemoryRouter>
      <AuthDialog onClose={vi.fn()} onAuthenticate={onAuthenticate} />
    </MemoryRouter>,
  )
}
async function submit() {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Номер телефона' }), {
    target: { value: '9991234567' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }))
  })
}
test('requires consent and a complete Russian mobile number', async () => {
  mount()
  expect(screen.getByRole('button', { name: 'Продолжить' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '999123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(startCall).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('полностью')
})
test('locks the phone, displays a safe tel link, and has no OTP or change-number control', async () => {
  mount()
  await submit()
  expect(startCall).toHaveBeenCalledWith('+79991234567', true, expect.any(AbortSignal))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Изменить номер|Сменить номер/ }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Одноразовый код')).not.toBeInTheDocument()
  expect(screen.queryByText(/^Ваш номер:/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Позвонить/ })).toHaveAttribute(
    'href',
    'tel:+78005008275',
  )
  expect(screen.getByText(/со своего номера/i)).toBeInTheDocument()
})
test('waiting polls only the status endpoint, confirmation signs in automatically', async () => {
  const onAuthenticate = vi.fn()
  mount(onAuthenticate)
  await submit()
  expect(checkCall).toHaveBeenCalledTimes(1)
  expect(onAuthenticate).not.toHaveBeenCalled()
  checkCall.mockResolvedValue({
    status: 'verified',
    user: { id: 'u1', phone: '+79991234567', name: '' },
  })
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(onAuthenticate).toHaveBeenCalledWith({ id: 'u1', phone: '+79991234567', name: '' })
  expect(startCall).toHaveBeenCalledTimes(1)
})
test('a start error does not unlock the phone input', async () => {
  startCall.mockRejectedValue(new Error('Сервис недоступен'))
  mount()
  await submit()
  expect(screen.getByRole('alert')).toHaveTextContent('Сервис недоступен')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Повторить проверку/ })).toBeDisabled()
})
test('closing and mounting a new dialog permits entering another phone', async () => {
  const first = mount()
  await submit()
  first.unmount()
  mount()
  expect(screen.getByRole('textbox', { name: 'Номер телефона' })).toHaveValue('+7')
  expect(screen.queryByRole('link', { name: /Позвонить/ })).not.toBeInTheDocument()
})
test('expiry stops polling and never starts a new registration automatically', async () => {
  mount()
  await submit()
  await act(async () => {
    vi.advanceTimersByTime(300000)
  })
  expect(screen.getByText(/Время ожидания истекло/)).toBeInTheDocument()
  const polls = checkCall.mock.calls.length
  await act(async () => {
    vi.advanceTimersByTime(60000)
  })
  expect(checkCall).toHaveBeenCalledTimes(polls)
  expect(startCall).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
test('a status error retries status without creating another registration', async () => {
  checkCall.mockRejectedValueOnce(new Error('Нет связи'))
  mount()
  await submit()
  expect(screen.getByRole('alert')).toHaveTextContent('Нет связи')
  await act(async () => {
    vi.advanceTimersByTime(5000)
  })
  expect(checkCall).toHaveBeenCalledTimes(2)
  expect(startCall).toHaveBeenCalledTimes(1)
})
test('unmount aborts status polling and ignores late confirmation', async () => {
  let complete!: (result: unknown) => void
  checkCall.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const onAuthenticate = vi.fn()
  const view = mount(onAuthenticate)
  await submit()
  const signal = checkCall.mock.calls[0]![2] as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => complete({ status: 'verified', user: { id: 'u1' } }))
  expect(onAuthenticate).not.toHaveBeenCalled()
})
test('the phone is locked while the initial request is still pending', async () => {
  let complete!: (result: unknown) => void
  startCall.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  mount()
  await submit()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(startCall).toHaveBeenCalledTimes(1)
  await act(async () =>
    complete({
      status: 'accepted',
      attemptToken: 'A'.repeat(43),
      callPhone: '+78005008275',
      expiresAt: Date.now() + 300000,
      retryAfterSeconds: 60,
    }),
  )
})

test('manual retry after a failure uses the same locked phone and is never automatic', async () => {
  startCall.mockRejectedValueOnce(new Error('Недоступно'))
  mount()
  await submit()
  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  expect(startCall).toHaveBeenCalledTimes(1)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  })
  expect(startCall).toHaveBeenCalledTimes(2)
  expect(startCall.mock.calls[1]![0]).toBe('+79991234567')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('a hidden tab waits until visible, and overlapping focus events cannot duplicate an in-flight poll', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  let finish!: (value: unknown) => void
  checkCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  try {
    mount()
    await submit()
    expect(checkCall).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })
    expect(checkCall).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(20_000)
    })
    expect(checkCall).toHaveBeenCalledTimes(1)
    await act(async () => finish({ status: 'waiting', pollAfterSeconds: 3 }))
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })
    expect(checkCall).toHaveBeenCalledTimes(2)
    expect(startCall).toHaveBeenCalledTimes(1)
  } finally {
    visibility.mockRestore()
  }
})

test('provider expiry stops status checks even when the window is refocused', async () => {
  checkCall.mockResolvedValue({ status: 'expired' })
  mount()
  await submit()
  expect(screen.getByText(/Время ожидания истекло/)).toBeInTheDocument()
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(10_000)
  })
  expect(checkCall).toHaveBeenCalledTimes(1)
  expect(startCall).toHaveBeenCalledTimes(1)
})

test('closing while registration is pending aborts it and ignores the late response', async () => {
  let finish!: (value: unknown) => void
  startCall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const onAuthenticate = vi.fn()
  const view = mount(onAuthenticate)
  await submit()
  const signal = startCall.mock.calls[0]![2] as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () =>
    finish({
      status: 'accepted',
      attemptToken: 'A'.repeat(43),
      callPhone: '+78005008275',
      expiresAt: Date.now() + 300000,
      retryAfterSeconds: 60,
    }),
  )
  expect(checkCall).not.toHaveBeenCalled()
  expect(onAuthenticate).not.toHaveBeenCalled()
})

test('provider expiry clears an earlier unavailable warning instead of promising another status check', async () => {
  checkCall
    .mockResolvedValueOnce({ status: 'unavailable', pollAfterSeconds: 3 })
    .mockResolvedValueOnce({ status: 'expired' })
  mount()
  await submit()
  expect(screen.getByRole('alert')).toHaveTextContent('Проверим звонок повторно')
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(screen.getByText(/Время ожидания истекло/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(startCall).toHaveBeenCalledTimes(1)
})

test('local expiry hides an old network warning even while the last status request is pending', async () => {
  startCall.mockResolvedValueOnce({
    status: 'accepted',
    attemptToken: 'A'.repeat(43),
    callPhone: '+78005008275',
    expiresAt: Date.now() + 2000,
    retryAfterSeconds: 60,
  })
  checkCall.mockRejectedValueOnce(new Error('Нет связи'))
  mount()
  await submit()
  expect(screen.getByRole('alert')).toHaveTextContent('Нет связи')
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
  expect(screen.getByText(/Время ожидания истекло/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Позвонить' })).not.toBeInTheDocument()
  expect(startCall).toHaveBeenCalledTimes(1)
})

test('clicking the consent text toggles the checkbox, while the document link closes without starting authentication', () => {
  const onClose = vi.fn()
  render(
    <MemoryRouter>
      <AuthDialog onClose={onClose} onAuthenticate={vi.fn()} />
    </MemoryRouter>,
  )
  const checkbox = screen.getByRole('checkbox')
  fireEvent.click(screen.getByText(/Соглашаюсь на/))
  expect(checkbox).toBeChecked()
  fireEvent.click(screen.getByText(/Соглашаюсь на/))
  expect(checkbox).not.toBeChecked()
  fireEvent.click(screen.getByRole('link', { name: 'обработку персональных данных' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(checkbox).not.toBeChecked()
  expect(startCall).not.toHaveBeenCalled()
})

test('pressing Enter repeatedly while registration is pending cannot create another request', async () => {
  startCall.mockImplementationOnce(() => new Promise(() => {}))
  mount()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9991234567' } })
  const form = screen.getByRole('button', { name: 'Продолжить' }).closest('form')!
  await act(async () => {
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(startCall).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

test('confirmation keeps keyboard focus inside the dialog and polling does not steal it back', async () => {
  mount()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '9991234567' } })
  const button = screen.getByRole('button', { name: 'Продолжить' })
  button.focus()
  await act(async () => {
    fireEvent.click(button)
  })
  expect(screen.getByRole('heading', { name: 'Подтвердите телефон звонком' })).toHaveFocus()
  const dial = screen.getByRole('link', { name: 'Позвонить' })
  dial.focus()
  await act(async () => {
    vi.advanceTimersByTime(3000)
  })
  expect(dial).toHaveFocus()
})

test('manual retry keeps keyboard focus inside the dialog while awaiting the new registration', async () => {
  startCall
    .mockRejectedValueOnce(new Error('Нет связи'))
    .mockImplementationOnce(() => new Promise(() => {}))
  mount()
  await submit()
  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })
  const retry = screen.getByRole('button', { name: 'Повторить проверку' })
  retry.focus()
  await act(async () => {
    fireEvent.click(retry)
  })
  expect(screen.getByRole('heading', { name: 'Подтвердите телефон звонком' })).toHaveFocus()
  expect(screen.getByText('Получаем номер для звонка…')).toBeInTheDocument()
})
