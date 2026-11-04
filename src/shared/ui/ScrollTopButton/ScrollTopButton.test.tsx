import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScrollTopButton } from './ScrollTopButton'

function mockScroll(y: number, viewportHeight: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  Object.defineProperty(window, 'innerHeight', {
    value: viewportHeight,
    configurable: true,
    writable: true,
  })
  fireEvent.scroll(window)
}

test('появляется после прокрутки больше экрана и прячется у верха', async () => {
  render(<ScrollTopButton />)
  const button = screen.getByRole('button', { hidden: true })

  mockScroll(100, 800)
  await waitFor(() => expect(button).toHaveAttribute('aria-hidden', 'true'))

  mockScroll(900, 800)
  await waitFor(() => expect(button).toHaveAttribute('aria-hidden', 'false'))

  mockScroll(0, 800)
  await waitFor(() => expect(button).toHaveAttribute('aria-hidden', 'true'))
})

test('по клику прокручивает страницу в самый верх', async () => {
  const user = userEvent.setup()
  const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(<ScrollTopButton />)

  mockScroll(900, 800)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Наверх' })).toHaveAttribute('aria-hidden', 'false'),
  )
  await user.click(screen.getByRole('button', { name: 'Наверх' }))

  expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  scrollToSpy.mockRestore()
})
