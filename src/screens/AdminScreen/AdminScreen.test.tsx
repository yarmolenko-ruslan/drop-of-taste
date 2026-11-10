import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { defaultSiteContent, type SiteContent } from '../../../shared/site-content'
import {
  SiteContentProvider,
  useSiteContent,
} from '../../features/site-content/SiteContentProvider'
import { AdminScreen } from './AdminScreen'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', () => ({ apiRequest: request }))

function SiteName() {
  return <output aria-label="Название на сайте">{useSiteContent().brandName}</output>
}

beforeEach(() => {
  request.mockReset()
})

test('сохранение в админке сразу обновляет сайт и повторное сохранение отправляет только новую правку', async () => {
  let content: SiteContent = { ...defaultSiteContent, brandName: 'Первое имя' }
  const patches: Partial<SiteContent>[] = []
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/admin/session') return { authenticated: true }
    if (path === '/admin/dashboard')
      return { content, categories: [], products: [], iikoConfigured: false }
    if (path === '/admin/orders?stage=new&limit=50') return { orders: [], nextBefore: null }
    if (path === '/site-content') return content
    if (path === '/admin/content' && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Partial<SiteContent>
      patches.push(patch)
      content = { ...content, ...patch }
      return { content }
    }
    throw new Error(`Неожиданный запрос: ${path}`)
  })
  const user = userEvent.setup()
  render(
    <SiteContentProvider>
      <MemoryRouter>
        <AdminScreen />
        <SiteName />
      </MemoryRouter>
    </SiteContentProvider>,
  )
  expect(await screen.findByText('Первое имя')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Сайт и баннеры' }))
  await user.clear(screen.getByRole('textbox', { name: 'Название кафе' }))
  await user.type(screen.getByRole('textbox', { name: 'Название кафе' }), 'Новое имя')
  await user.click(screen.getAllByRole('button', { name: 'Сохранить сайт' })[0]!)
  await waitFor(() =>
    expect(screen.getByRole('status', { name: 'Название на сайте' })).toHaveTextContent(
      'Новое имя',
    ),
  )
  await user.clear(screen.getByRole('textbox', { name: 'Название кафе' }))
  await user.type(screen.getByRole('textbox', { name: 'Название кафе' }), 'Третье имя')
  await user.click(screen.getAllByRole('button', { name: 'Сохранить сайт' })[0]!)
  await waitFor(() => expect(patches).toHaveLength(2))
  expect(patches[1]).toEqual({ brandName: 'Третье имя' })
})
