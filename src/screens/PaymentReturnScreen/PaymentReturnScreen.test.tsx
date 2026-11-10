import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { PaymentReturnScreen } from './PaymentReturnScreen'

afterEach(() => vi.unstubAllGlobals())

test('возврат с ЮKassa показывает успех только после проверки сервером', async () => {
  let finishCheck!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishCheck = resolve
        }),
    ),
  )
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  expect(screen.getByText('Проверяем оплату в ЮKassa…')).toBeInTheDocument()
  finishCheck(Response.json({ status: 'succeeded' }))
  expect(await screen.findByText('Оплата прошла успешно.')).toBeInTheDocument()
})

test('отменённый платёж не показывается как оплаченный', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'canceled' })),
  )
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  expect(
    await screen.findByText('Платёж отменён. Вы можете оформить новый заказ.'),
  ).toBeInTheDocument()
  expect(screen.queryByText('Оплата прошла успешно.')).not.toBeInTheDocument()
})

test('незавершённый платёж предлагает вернуться к оплате', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'pending' })),
  )
  render(
    <MemoryRouter initialEntries={['/payment/return?orderId=order-123']}>
      <PaymentReturnScreen />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('button', { name: 'Вернуться к оплате' })).toBeInTheDocument()
  expect(
    screen.getByText('Платёж пока не завершён. Вы можете вернуться к оплате.'),
  ).toBeInTheDocument()
})
