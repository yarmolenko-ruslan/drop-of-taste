import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { FulfillmentDialog } from './FulfillmentDialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

test('сохраняет доставку по введённому адресу в личном кабинете', () => {
  const onSave = vi.fn()
  render(<FulfillmentDialog onClose={() => {}} onSave={onSave} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Улица и дом' }), {
    target: { value: 'ул. Мира, 10' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Подъезд' }), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Этаж' }), { target: { value: '3' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Квартира' }), { target: { value: '25' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).toHaveBeenCalledWith({
    mode: 'delivery',
    label: 'ул. Мира, 10, подъезд 2, 3 этаж, квартира 25',
    details: {
      street: 'ул. Мира, 10',
      entrance: '2',
      floor: '3',
      flat: '25',
      comment: '',
      isHouse: false,
    },
  })
})

test('требует квартиру, подъезд и этаж, пока не отмечен частный дом', () => {
  const onSave = vi.fn()
  render(<FulfillmentDialog onClose={() => {}} onSave={onSave} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Улица и дом' }), {
    target: { value: 'ул. Мира, 10' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('checkbox', { name: 'Частный дом' }))
  expect(screen.getByRole('textbox', { name: 'Квартира' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).toHaveBeenCalledWith({
    mode: 'delivery',
    label: 'ул. Мира, 10',
    details: {
      street: 'ул. Мира, 10',
      entrance: '',
      floor: '',
      flat: '',
      comment: '',
      isHouse: true,
    },
  })
})

test('показывает ошибки обязательных полей при пустой форме доставки', () => {
  const onSave = vi.fn()
  render(<FulfillmentDialog onClose={() => {}} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByText('Укажите улицу и номер дома')).toBeInTheDocument()
  expect(screen.getByText('Укажите подъезд')).toBeInTheDocument()
  expect(screen.getByText('Укажите этаж')).toBeInTheDocument()
  expect(screen.getByText('Укажите квартиру')).toBeInTheDocument()
})

test('не сохраняет адрес с буквами в подъезде и сбрасывает ошибку после исправления', () => {
  const onSave = vi.fn()
  render(<FulfillmentDialog onClose={() => {}} onSave={onSave} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Улица и дом' }), {
    target: { value: 'ул. Мира, 10' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Подъезд' }), { target: { value: '2а' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Этаж' }), { target: { value: '3' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Квартира' }), { target: { value: '25' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Подъезд — только цифры, до 3 знаков')

  fireEvent.change(screen.getByRole('textbox', { name: 'Подъезд' }), { target: { value: '2' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).toHaveBeenCalledTimes(1)
})

test('подставляет текущий адрес при редактировании', () => {
  const onSave = vi.fn()
  const details = {
    street: 'ул. Апрельская, 18',
    entrance: '1',
    floor: '8',
    flat: '44',
    comment: 'Домофон не работает',
    isHouse: false,
  }
  render(
    <FulfillmentDialog
      current={{ mode: 'delivery', label: 'ул. Апрельская, 18', details }}
      onClose={() => {}}
      onSave={onSave}
    />,
  )

  expect(screen.getByRole('textbox', { name: 'Улица и дом' })).toHaveValue('ул. Апрельская, 18')
  expect(screen.getByRole('textbox', { name: 'Подъезд' })).toHaveValue('1')
  expect(screen.getByRole('textbox', { name: 'Этаж' })).toHaveValue('8')
  expect(screen.getByRole('textbox', { name: 'Квартира' })).toHaveValue('44')
  expect(screen.getByRole('textbox', { name: 'Комментарий к адресу' })).toHaveValue(
    'Домофон не работает',
  )

  fireEvent.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(onSave).toHaveBeenCalledWith({
    mode: 'delivery',
    label: 'ул. Апрельская, 18, подъезд 1, 8 этаж, квартира 44',
    details,
  })
})
