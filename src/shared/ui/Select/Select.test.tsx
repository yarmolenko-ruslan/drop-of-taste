import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { Select } from './Select'

function Example({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('all')
  return (
    <>
      <label>
        Клиенты
        <Select value={value} onValueChange={setValue} disabled={disabled} name="filter">
          <option value="all">Все клиенты</option>
          <option value="blocked" disabled>
            Недоступно
          </option>
          <option value="ordered">С заказами</option>
          <option value="empty">Без заказов</option>
        </Select>
      </label>
      <button>Следующее поле</button>
    </>
  )
}

test('единый список связан с подписью, выбирает значение и не содержит нативного select', async () => {
  const user = userEvent.setup()
  const { container } = render(<Example />)
  const trigger = screen.getByRole('combobox', { name: 'Клиенты' })
  expect(container.querySelector('select')).toBeNull()
  await user.click(trigger)
  expect(container).not.toContainElement(screen.getByRole('listbox'))
  await user.click(screen.getByRole('option', { name: 'С заказами' }))
  expect(trigger).toHaveTextContent('С заказами')
  expect(trigger).toHaveFocus()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(container.querySelector('input[name="filter"]')).toHaveValue('ordered')
})

test('клавиатура пропускает недоступные варианты, поддерживает поиск, границы, Escape и Tab', async () => {
  const user = userEvent.setup()
  render(<Example />)
  const trigger = screen.getByLabelText('Клиенты')
  trigger.focus()
  await user.keyboard('{ArrowDown}{ArrowDown}')
  expect(screen.getByRole('option', { name: 'С заказами' })).toHaveFocus()
  await user.keyboard('{End}')
  expect(screen.getByRole('option', { name: 'Без заказов' })).toHaveFocus()
  await user.keyboard('{Home}')
  expect(screen.getByRole('option', { name: 'Все клиенты' })).toHaveFocus()
  await user.keyboard('Без')
  expect(screen.getByRole('option', { name: 'Без заказов' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(trigger).toHaveTextContent('Все клиенты')
  expect(trigger).toHaveFocus()
  await user.click(trigger)
  await user.tab()
  expect(screen.getByRole('button', { name: 'Следующее поле' })).toHaveFocus()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  await user.click(trigger)
  await user.keyboard('{ArrowUp}{Enter}')
  expect(trigger).toHaveTextContent('Без заказов')
})

test('список закрывается снаружи, не открывается в отключённом fieldset и не отправляет форму', async () => {
  const user = userEvent.setup()
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault())
  const { rerender } = render(
    <form onSubmit={submit}>
      <Example />
    </form>,
  )
  await user.click(screen.getByLabelText('Клиенты'))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(submit).not.toHaveBeenCalled()
  rerender(
    <fieldset disabled>
      <Example />
    </fieldset>,
  )
  expect(screen.getByLabelText('Клиенты')).toBeDisabled()
  await user.click(screen.getByLabelText('Клиенты'))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('меню помещается над полем у нижнего края и обновляет позицию после прокрутки', async () => {
  const user = userEvent.setup()
  render(<Example />)
  const trigger = screen.getByLabelText('Клиенты')
  const rect = {
    x: 900,
    y: 700,
    top: 700,
    bottom: 744,
    left: 900,
    right: 1100,
    width: 200,
    height: 44,
    toJSON: () => ({}),
  }
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => rect)
  const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(320)
  try {
    await user.click(trigger)
    const menu = screen.getByRole('listbox')
    expect(parseFloat(menu.style.top)).toBeLessThan(rect.top)
    expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(
      window.innerWidth - 8,
    )
    rect.top = 100
    rect.bottom = 144
    fireEvent.scroll(window)
    expect(menu.style.top).toBe('150px')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  } finally {
    height.mockRestore()
  }
})

test('длинный список числовых значений ищется с клавиатуры и работает внутри диалога', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <dialog open>
      <label>
        Год
        <Select value="" onValueChange={onChange}>
          <option value="">Год</option>
          {Array.from({ length: 127 }, (_, index) => 2026 - index).map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
      </label>
    </dialog>,
  )
  const trigger = screen.getByRole('combobox', { name: 'Год' })
  trigger.focus()
  await user.keyboard('1992')
  const option = screen.getByRole('option', { name: '1992' })
  expect(option).toHaveFocus()
  expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('listbox'))
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledWith('1992')
  expect(trigger).toHaveFocus()
})

test('блокировка открытого списка закрывает его без повторного открытия после разблокировки', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<Example />)
  await user.click(screen.getByLabelText('Клиенты'))
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  rerender(<Example disabled />)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  rerender(<Example />)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('блокировка fieldset закрывает уже открытое меню и не позволяет выбрать значение', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <fieldset>
      <Example />
    </fieldset>,
  )
  await user.click(screen.getByLabelText('Клиенты'))
  rerender(
    <fieldset disabled>
      <Example />
    </fieldset>,
  )
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  rerender(
    <fieldset>
      <Example />
    </fieldset>,
  )
  expect(screen.getByLabelText('Клиенты')).toHaveTextContent('Все клиенты')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})

test('при обновлении вариантов открытого списка фокус остаётся на доступном варианте', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const { rerender } = render(
    <label>
      Раздел
      <Select value="a" onValueChange={onChange}>
        <option value="a">Первый</option>
        <option value="b">Второй</option>
      </Select>
    </label>,
  )
  await user.click(screen.getByLabelText('Раздел'))
  await user.keyboard('{End}')
  rerender(
    <label>
      Раздел
      <Select value="a" onValueChange={onChange}>
        <option value="a">Первый</option>
      </Select>
    </label>,
  )
  expect(screen.getByRole('option', { name: 'Первый' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})
