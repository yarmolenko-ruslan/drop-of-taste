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
