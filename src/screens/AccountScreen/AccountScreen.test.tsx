import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AccountScreen } from './AccountScreen'

const userData = { name: 'Руслан Ярмоленко', phone: '+7 999 123-45-67' }

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

function renderAccount(section = 'orders', onUpdateUser = () => {}) {
  return render(
    <MemoryRouter initialEntries={[`/account/${section}`]}>
      <Routes>
        <Route
          path="/account/:section?"
          element={
            <AccountScreen user={userData} onLogout={() => {}} onUpdateUser={onUpdateUser} />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

test('переключает разделы и добавляет адрес доставки', async () => {
  const user = userEvent.setup()
  renderAccount()

  expect(screen.getByRole('heading', { name: 'Активные заказы' })).toBeInTheDocument()
  expect(screen.queryByText('Подарить сертификат')).not.toBeInTheDocument()
  expect(screen.queryByText('Мои сертификаты')).not.toBeInTheDocument()

  await user.click(screen.getByRole('link', { name: 'Адреса доставки' }))
  await user.click(screen.getByRole('button', { name: 'Добавить новый адрес' }))
  expect(screen.queryByRole('button', { name: 'Самовывоз −10%' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Улица и дом' }), 'ул. Мира, 10')
  await user.type(screen.getByRole('textbox', { name: 'Подъезд' }), '2')
  await user.type(screen.getByRole('textbox', { name: 'Этаж' }), '3')
  await user.type(screen.getByRole('textbox', { name: 'Квартира' }), '25')
  await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))

  expect(screen.getByText('ул. Мира, 10, подъезд 2, 3 этаж, квартира 25')).toBeInTheDocument()
  expect(screen.getByRole('radio')).toBeChecked()
  expect(screen.getByText('Выбран')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('редактирует адрес доставки по кнопке изменения', async () => {
  const user = userEvent.setup()
  renderAccount('addresses')

  await user.click(screen.getByRole('button', { name: 'Добавить новый адрес' }))
  await user.type(screen.getByRole('textbox', { name: 'Улица и дом' }), 'ул. Мира, 10')
  await user.type(screen.getByRole('textbox', { name: 'Подъезд' }), '2')
  await user.type(screen.getByRole('textbox', { name: 'Этаж' }), '3')
  await user.type(screen.getByRole('textbox', { name: 'Квартира' }), '25')
  await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))
  expect(
    screen.getByText('ул. Мира, 10, подъезд 2, 3 этаж, квартира 25'),
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /Изменить адрес/ }))
  const street = screen.getByRole('textbox', { name: 'Улица и дом' })
  expect(street).toHaveValue('ул. Мира, 10')
  expect(screen.getByRole('textbox', { name: 'Квартира' })).toHaveValue('25')
  await user.clear(street)
  await user.type(street, 'ул. Апрельская, 18')
  await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))

  expect(
    screen.getByText('ул. Апрельская, 18, подъезд 2, 3 этаж, квартира 25'),
  ).toBeInTheDocument()
  expect(screen.queryByText('ул. Мира, 10, подъезд 2, 3 этаж, квартира 25')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('удаляет адрес доставки по кнопке удаления', async () => {
  const user = userEvent.setup()
  renderAccount('addresses')

  await user.click(screen.getByRole('button', { name: 'Добавить новый адрес' }))
  await user.type(screen.getByRole('textbox', { name: 'Улица и дом' }), 'ул. Мира, 10')
  await user.type(screen.getByRole('textbox', { name: 'Подъезд' }), '2')
  await user.type(screen.getByRole('textbox', { name: 'Этаж' }), '3')
  await user.type(screen.getByRole('textbox', { name: 'Квартира' }), '25')
  await user.click(screen.getByRole('button', { name: 'Сохранить выбор' }))

  await user.click(screen.getByRole('button', { name: /Удалить адрес/ }))
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByText('Выбран')).not.toBeInTheDocument()
})

test('сохраняет имя и включает email-рассылку после заполнения почты', async () => {
  const user = userEvent.setup()
  const onUpdateUser = vi.fn()
  renderAccount('profile', onUpdateUser)

  const name = screen.getByRole('textbox', { name: 'Имя' })
  await user.clear(name)
  await user.type(name, 'Руслан')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(onUpdateUser).toHaveBeenCalledWith({ ...userData, name: 'Руслан' })
  expect(screen.getByRole('status')).toHaveTextContent('Личные данные сохранены')

  const emailSubscription = screen.getByRole('checkbox', { name: 'Email-рассылки' })
  expect(emailSubscription).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Эл. почта' }), 'test@example.ru')
  expect(emailSubscription).toBeEnabled()
})
