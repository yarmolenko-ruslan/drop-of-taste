import { render, screen, within } from '@testing-library/react'
import { OrderDetailsCard } from './OrderDetailsCard'
import type { Order } from './orders'

test('оплата отменённого заказа не выдаётся за успешное оформление', () => {
  const order: Order = {
    _id: 'late-payment',
    createdAt: '2026-11-21T10:00:00Z',
    canceledAt: '2026-11-21T10:15:00Z',
    paymentStatus: 'succeeded',
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { lines: [], discountKopecks: 0, deliveryKopecks: 0, totalKopecks: 10000 },
  }
  render(<OrderDetailsCard order={order} onRepeat={vi.fn()} paymentEnabled />)
  expect(screen.getByText('Заказ отменён')).toBeInTheDocument()
  expect(screen.getByText(/Оплачено после отмены.*для возврата/)).toBeInTheDocument()
  expect(screen.queryByText('Оплачено онлайн')).not.toBeInTheDocument()
})

test('включение оплаты не делает старый заказ без онлайн-оплаты ожидающим платежа', () => {
  const order: Order = {
    _id: 'offline-order',
    createdAt: '2026-11-21T10:00:00Z',
    paymentExpiresAt: null,
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'preparing',
    input: { fulfillment: { mode: 'pickup', label: 'Кафе' } },
    quote: { lines: [], discountKopecks: 0, deliveryKopecks: 0, totalKopecks: 10000 },
  }
  render(<OrderDetailsCard order={order} onRepeat={vi.fn()} paymentEnabled onPay={vi.fn()} />)
  expect(screen.getByText('Онлайн-оплата не предусмотрена')).toBeInTheDocument()
  expect(screen.queryByText('Ожидает оплаты')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Оплатить заказ' })).not.toBeInTheDocument()
  expect(screen.getAllByText('Приготовление')).toHaveLength(2)
})

test.each([{ adjustments: undefined }, { adjustments: [] }])(
  'старая детализация $adjustments сохраняет причину скидки дня рождения и доставку',
  ({ adjustments }) => {
    const order: Order = {
      _id: 'old-order',
      createdAt: '2026-11-21T10:00:00Z',
      input: { fulfillment: { mode: 'delivery', label: 'Адрес' } },
      quote: {
        lines: [],
        discountKopecks: 0,
        birthdayDiscountKopecks: 1500,
        deliveryKopecks: 500,
        totalKopecks: 9000,
        adjustments,
      },
    }
    render(<OrderDetailsCard order={order} onRepeat={vi.fn()} />)
    expect(screen.getByText('Скидка ко дню рождения')).toBeInTheDocument()
    expect(screen.getByText('−15 ₽')).toBeInTheDocument()
    expect(screen.getByText('5 ₽')).toBeInTheDocument()
  },
)

test.each(['pickup', 'delivery'] as const)(
  'этапы заказа учитывают способ получения: %s',
  (mode) => {
    const order: Order = {
      _id: 'order-123',
      createdAt: '2026-11-21T10:00:00Z',
      fulfillmentStatus: 'delivering',
      paymentStatus: 'succeeded',
      input: { fulfillment: { mode, label: 'Кафе' } },
      quote: { lines: [], discountKopecks: 0, deliveryKopecks: 0, totalKopecks: 10000 },
    }
    const view = render(<OrderDetailsCard order={order} onRepeat={vi.fn()} paymentEnabled />)
    if (mode === 'pickup') {
      const method = screen.getByText('Самовывоз', { selector: 'strong > span' })
      expect(method.nextElementSibling).toHaveTextContent('Кафе')
      expect(method.parentElement).not.toHaveTextContent('·')
    }
    const steps = within(screen.getByRole('list', { name: 'Этапы заказа' })).getAllByRole(
      'listitem',
    )
    expect(steps).toHaveLength(4)
    expect(steps[2]).toHaveTextContent(mode === 'pickup' ? 'Можно забирать' : 'Доставка')
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(screen.getAllByText(mode === 'pickup' ? 'Можно забирать' : 'Доставка')).toHaveLength(2)

    view.rerender(
      <OrderDetailsCard
        order={{ ...order, fulfillmentStatus: 'completed' }}
        onRepeat={vi.fn()}
        paymentEnabled
      />,
    )
    expect(steps[2]).not.toHaveAttribute('aria-current')
    expect(steps[3]).toHaveTextContent('Завершён')

    view.rerender(
      <OrderDetailsCard
        order={{ ...order, paymentStatus: 'unpaid' }}
        onRepeat={vi.fn()}
        paymentEnabled
      />,
    )
    expect(steps[2]).toHaveTextContent('Ожидается')
    expect(steps[2]).not.toHaveAttribute('aria-current')
    expect(screen.getAllByText('Ожидает оплаты', { selector: 'span' })).toHaveLength(2)
  },
)
