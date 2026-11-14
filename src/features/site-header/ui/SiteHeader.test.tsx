import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { vi } from 'vitest'
import { SiteHeader } from './SiteHeader'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

function scrollWindowTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  fireEvent.scroll(window)
}

test('номер в шапке открывает звонок без подписи', () => {
  render(
    <MemoryRouter>
      <SiteHeader phoneNumber="+7 (999) 123-45-67" />
    </MemoryRouter>,
  )

  expect(screen.getByRole('link', { name: '+7 (999) 123-45-67' })).toHaveAttribute(
    'href',
    'tel:+79991234567',
  )
  expect(screen.queryByText('Звонок бесплатный')).not.toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Категории меню' })).toBeInTheDocument()
})

test('номер без оформления показывается в едином формате', () => {
  render(
    <MemoryRouter>
      <SiteHeader phoneNumber="+79998887766" />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: '+7 (999) 888-77-66' })).toHaveAttribute(
    'href',
    'tel:+79998887766',
  )
})

test('«Акции» в хедере открывают отдельную страницу', () => {
  render(
    <MemoryRouter initialEntries={['/promotions']}>
      <SiteHeader />
    </MemoryRouter>,
  )
  const nav = screen.getByRole('navigation', { name: 'Категории меню' })
  expect(within(nav).getByRole('link', { name: 'Акции' })).toHaveAttribute('href', '/promotions')
  expect(within(nav).getByRole('link', { name: 'Акции' })).toHaveAttribute('aria-current', 'page')
})

test('подсвечивает раздел, до которого прокрутили главную страницу', async () => {
  render(
    <MemoryRouter>
      <SiteHeader />
      <section id="new" />
      <section id="breakfast" />
    </MemoryRouter>,
  )
  let newTop = 500
  let breakfastTop = 900
  vi.spyOn(document.getElementById('new')!, 'getBoundingClientRect').mockImplementation(
    () => ({ top: newTop }) as DOMRect,
  )
  vi.spyOn(document.getElementById('breakfast')!, 'getBoundingClientRect').mockImplementation(
    () => ({ top: breakfastTop }) as DOMRect,
  )
  const nav = screen.getByRole('navigation', { name: 'Категории меню' })
  newTop = 180
  fireEvent.scroll(window)
  await waitFor(() =>
    expect(within(nav).getByRole('link', { name: 'Новинки' })).toHaveAttribute(
      'aria-current',
      'location',
    ),
  )
  newTop = -300
  breakfastTop = 150
  fireEvent.scroll(window)
  await waitFor(() =>
    expect(within(nav).getByRole('link', { name: 'Завтраки' })).toHaveAttribute(
      'aria-current',
      'location',
    ),
  )
  expect(within(nav).getByRole('link', { name: 'Новинки' })).not.toHaveAttribute('aria-current')
})

test('скрывает меню категорий на странице «О ресторане»', () => {
  render(
    <MemoryRouter initialEntries={['/about']}>
      <SiteHeader />
    </MemoryRouter>,
  )

  expect(screen.queryByRole('navigation', { name: 'Категории меню' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Капела вкуса — главная' })).toBeInTheDocument()
})

test('компактный хедер появляется после прокрутки и прячется у верха страницы', async () => {
  render(
    <MemoryRouter>
      <SiteHeader />
    </MemoryRouter>,
  )
  // В jsdom offsetHeight = 0, поэтому порог срабатывания — любая прокрутка
  const compact = screen.getByRole('region', { hidden: true })
  expect(compact).toHaveAttribute('aria-hidden', 'true')

  scrollWindowTo(200)
  await waitFor(() => expect(compact).toHaveAttribute('aria-hidden', 'false'))

  scrollWindowTo(0)
  await waitFor(() => expect(compact).toHaveAttribute('aria-hidden', 'true'))
})

test('компактный хедер содержит логотип, категории, кабинет и корзину', async () => {
  render(
    <MemoryRouter>
      <SiteHeader accountLabel="Руслан" />
    </MemoryRouter>,
  )

  const compact = screen.getByRole('region', { hidden: true })
  scrollWindowTo(200)
  await waitFor(() => expect(compact).toHaveAttribute('aria-hidden', 'false'))

  expect(compact).toHaveTextContent('Акции')
  expect(compact).toHaveTextContent('Комбо')
  expect(compact).toHaveAccessibleName()
  expect(screen.getAllByRole('button', { name: 'Руслан' }).length).toBe(2)
  expect(screen.getAllByRole('button', { name: /Корзина, 0 поз\./ }).length).toBe(2)
})

test('стрелки обеих полос прокручивают категории на один пункт и отключаются на краях', () => {
  render(
    <MemoryRouter>
      <SiteHeader />
    </MemoryRouter>,
  )

  const navs = screen.getAllByRole('navigation', { name: 'Категории меню', hidden: true })
  for (const nav of navs) {
    const viewport = nav.querySelector('[class*="scrollViewport"]') as HTMLDivElement
    const links = Array.from(viewport.querySelectorAll('a'))
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    })
    links.slice(0, 3).forEach((link, index) => {
      Object.defineProperty(link, 'offsetLeft', { configurable: true, value: index * 120 })
    })
    const scrollTo = vi.fn()
    viewport.scrollTo = scrollTo
    fireEvent.scroll(viewport)

    const left = within(nav).getByRole('button', {
      name: 'Прокрутить категории влево',
      hidden: true,
    })
    const right = within(nav).getByRole('button', {
      name: 'Прокрутить категории вправо',
      hidden: true,
    })
    expect(left).toBeDisabled()
    expect(right).toBeEnabled()
    fireEvent.click(right)
    expect(scrollTo).toHaveBeenCalledWith({ left: 120, behavior: 'smooth' })

    viewport.scrollLeft = 120
    fireEvent.scroll(viewport)
    fireEvent.click(right)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 240, behavior: 'smooth' })
    fireEvent.click(left)
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' })

    viewport.scrollLeft = 420
    fireEvent.scroll(viewport)
    expect(right).toBeDisabled()
  }
})

test('перетаскивание мышью прокручивает список без перехода по ссылке', () => {
  function Path() {
    return <span data-testid="path">{useLocation().pathname}</span>
  }
  render(
    <MemoryRouter>
      <SiteHeader />
      <Path />
    </MemoryRouter>,
  )
  const nav = screen.getByRole('navigation', { name: 'Категории меню' })
  const viewport = nav.querySelector('[class*="scrollViewport"]') as HTMLDivElement
  const link = within(nav).getByRole('link', { name: 'Акции' })
  viewport.scrollLeft = 100
  viewport.setPointerCapture = vi.fn()
  viewport.hasPointerCapture = vi.fn(() => true)
  viewport.releasePointerCapture = vi.fn()

  fireEvent.pointerDown(link, { pointerType: 'mouse', button: 0, clientX: 200, pointerId: 1 })
  fireEvent.pointerMove(viewport, { pointerType: 'mouse', clientX: 170, pointerId: 1 })
  expect(viewport.scrollLeft).toBe(130)
  fireEvent.pointerUp(viewport, { pointerType: 'mouse', clientX: 170, pointerId: 1 })
  expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1)
  fireEvent.click(link)
  expect(screen.getByTestId('path').textContent).toBe('/')
  fireEvent.click(link)
  expect(screen.getByTestId('path')).toHaveTextContent('/promotions')
})

test('бургер открывает меню с разделами сайта и закрывается после выбора', () => {
  render(
    <MemoryRouter>
      <SiteHeader phoneNumber="+7 123 456-78-90" />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }))
  const menu = screen.getByRole('dialog', { name: 'КАПЕЛА ВКУСА' })
  expect(within(menu).getByRole('navigation', { name: 'Мобильное меню' })).toBeInTheDocument()
  expect(within(menu).getByRole('link', { name: 'Завтраки' })).toHaveAttribute(
    'href',
    '/#breakfast',
  )
  expect(within(menu).getByRole('link', { name: 'Доставка и оплата' })).toHaveAttribute(
    'href',
    '/#delivery',
  )
  fireEvent.click(within(menu).getByRole('link', { name: 'О нас' }))
  expect(screen.queryByRole('dialog', { name: 'КАПЕЛА ВКУСА' })).not.toBeInTheDocument()
})

test('карта открывается из мобильного меню и меню закрывается', () => {
  const onAddressClick = vi.fn()
  render(
    <MemoryRouter>
      <SiteHeader onAddressClick={onAddressClick} />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }))
  const menu = screen.getByRole('dialog', { name: 'КАПЕЛА ВКУСА' })
  fireEvent.click(within(menu).getByRole('button', { name: /Кафе на карте/ }))
  expect(onAddressClick).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog', { name: 'КАПЕЛА ВКУСА' })).not.toBeInTheDocument()
})

test('поиск отправляет запрос из шапки на страницу результатов', () => {
  function CurrentLocation() {
    const { pathname, search } = useLocation()
    return <output data-testid="location">{pathname + search}</output>
  }

  render(
    <MemoryRouter initialEntries={['/about']}>
      <SiteHeader />
      <CurrentLocation />
    </MemoryRouter>,
  )

  fireEvent.change(screen.getByRole('searchbox', { name: 'Искать блюда' }), {
    target: { value: '  Сырники  ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Найти блюда' }))
  expect(screen.getByTestId('location')).toHaveTextContent(
    '/search?q=%D0%A1%D1%8B%D1%80%D0%BD%D0%B8%D0%BA%D0%B8',
  )
})
