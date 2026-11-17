import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { defaultSiteContent } from '../../../shared/site-content'
import { CatalogProvider, useCatalog } from '../catalog/api/CatalogProvider'
import { publishSiteUpdate } from '../../shared/lib/siteUpdates'
import { SiteContentProvider, useSiteContent } from './SiteContentProvider'

const request = vi.hoisted(() => vi.fn())
vi.mock('../auth/api/authApi', () => ({ apiRequest: request }))

function Probe() {
  const content = useSiteContent()
  const catalog = useCatalog()
  return (
    <p>
      {content.brandName} · {catalog?.data?.categories[0]?.title ?? 'Нет меню'}
    </p>
  )
}

beforeEach(() => {
  request.mockReset()
})

test('настройки применяются к цветам, описанию страницы и значку вкладки', async () => {
  const icon = document.createElement('link')
  icon.rel = 'icon'
  document.head.append(icon)
  request.mockResolvedValue({
    ...defaultSiteContent,
    brandName: 'Проверка оформления',
    settings: {
      ...defaultSiteContent.settings,
      seoDescription: 'Новое описание',
      favicon: '/custom-icon.png',
      appearance: { ...defaultSiteContent.settings.appearance, brand: '#123456' },
    },
  })
  render(
    <SiteContentProvider>
      <Probe />
    </SiteContentProvider>,
  )
  await screen.findByText(/Проверка оформления/)
  expect(document.documentElement.style.getPropertyValue('--color-brand-red')).toBe('#123456')
  expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
    'content',
    'Новое описание',
  )
  expect(icon).toHaveAttribute('href', '/custom-icon.png')
  icon.remove()
})

test('возвращение связи обновляет каталог даже без события сохранения', async () => {
  let categoryTitle = 'Старое меню'
  request.mockImplementation(async () => ({
    categories: [{ id: 'food', title: categoryTitle, subtitle: '', products: [] }],
    newArrivalIds: [],
  }))
  render(
    <CatalogProvider>
      <Probe />
    </CatalogProvider>,
  )
  expect(await screen.findByText(/Старое меню/)).toBeInTheDocument()
  categoryTitle = 'Новое меню'
  act(() => window.dispatchEvent(new Event('online')))
  expect(await screen.findByText(/Новое меню/)).toBeInTheDocument()
})

test('сохранение в админке сразу обновляет содержимое и каталог на открытом сайте', async () => {
  let brandName = 'Первое название'
  let categoryTitle = 'Первое меню'
  request.mockImplementation(async (path: string) =>
    path === '/site-content'
      ? { ...defaultSiteContent, brandName }
      : {
          categories: [{ id: 'food', title: categoryTitle, subtitle: '', products: [] }],
          newArrivalIds: [],
        },
  )
  render(
    <SiteContentProvider>
      <CatalogProvider>
        <Probe />
      </CatalogProvider>
    </SiteContentProvider>,
  )
  expect(await screen.findByText('Первое название · Первое меню')).toBeInTheDocument()
  brandName = 'Новое название'
  categoryTitle = 'Новое меню'
  act(() => {
    publishSiteUpdate('content')
    publishSiteUpdate('catalog')
  })
  await waitFor(() => expect(screen.getByText('Новое название · Новое меню')).toBeInTheDocument())
})
