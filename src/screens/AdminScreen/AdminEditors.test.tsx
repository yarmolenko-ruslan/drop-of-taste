import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultSiteContent } from '../../../shared/site-content'
import { ContentEditor } from './ContentEditor'
import { CategoriesEditor, ProductsEditor } from './CatalogEditors'
import { ImageField } from './AdminFields'
import { BonusCodesEditor } from './BonusCodesEditor'
import type { Dashboard, Product } from './adminTypes'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../features/auth/api/authApi', () => ({ apiRequest: request }))
beforeEach(() => {
  request.mockReset()
})
const data: Dashboard = {
  content: defaultSiteContent,
  iikoConfigured: false,
  products: [],
  categories: [
    { _id: 'first', title: 'Первый', subtitle: '', sortOrder: 0 },
    { _id: 'second', title: 'Второй', subtitle: '', sortOrder: 1 },
  ],
}

test('нативный ввод дат сохраняет период бонус-кода', async () => {
  request.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (!init) return { codes: [] }
    return { code: { ...JSON.parse(String(init.body)), _id: 'DATECHECK' } }
  })
  render(<BonusCodesEditor />)
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByRole('textbox', { name: 'Код для клиента' }), {
    target: { value: 'DATECHECK' },
  })
  fireEvent.input(screen.getByLabelText('Действует с'), { target: { value: '2026-11-01T00:00' } })
  fireEvent.input(screen.getByLabelText('Действует до'), { target: { value: '2027-01-01T00:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить бонус-код' }))
  await screen.findByText('Бонус-код сохранён')
  const write = request.mock.calls.find(([, init]) => init?.method === 'POST')!
  const payload = JSON.parse(write[1].body)
  expect(Date.parse(payload.startsAt)).toBeLessThan(Date.parse(payload.endsAt))
  expect(payload.code).toBe('DATECHECK')
})

test('новый баннер имеет сохраняемое название, настройки и порядок попадают в запрос', async () => {
  request.mockImplementation(async (_path: string, init: RequestInit) => ({
    content: { ...defaultSiteContent, ...JSON.parse(String(init.body)) },
  }))
  render(<ContentEditor initial={defaultSiteContent} onSaved={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить баннер' }))
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Название баннера' }).at(-1)!, {
    target: { value: 'Новый баннер из панели' },
  })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Стоимость доставки, ₽' }), {
    target: { value: '325.50' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Основной цвет (HEX)' }), {
    target: { value: '#123456' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить сайт' })[0]!)
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  const patch = JSON.parse(request.mock.calls[0]![1].body)
  expect(patch.heroSlides.at(-1)).toMatchObject({
    title: 'Новый баннер из панели',
    description: '',
    badge: '',
  })
  expect(patch.settings.delivery.feeKopecks).toBe(32550)
  expect(patch.settings.appearance.brand).toBe('#123456')
})

test('состав и добавки можно набирать через запятую; отказ обновления списка не создаёт второй товар', async () => {
  const refresh = vi.fn().mockRejectedValue(new Error('offline'))
  request.mockImplementation(async (_path: string, init: RequestInit) => ({
    product: { ...JSON.parse(String(init.body)), _id: 'created' } as Product,
  }))
  render(<ProductsEditor data={data} refresh={refresh} />)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Суп')
  await user.type(
    screen.getByRole('textbox', { name: 'Состав, через запятую' }),
    'Картофель, морковь, зелень',
  )
  await user.type(screen.getByRole('textbox', { name: 'Добавки, через запятую' }), 'Сметана, хлеб')
  await user.click(screen.getAllByRole('button', { name: 'Сохранить товар' })[0]!)
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  const payload = JSON.parse(request.mock.calls[0]![1].body)
  expect(payload.ingredients).toEqual(['Картофель', 'морковь', 'зелень'])
  expect(payload.extras).toEqual(['Сметана', 'хлеб'])
  await user.click(screen.getAllByRole('button', { name: 'Сохранить товар' })[0]!)
  expect(request.mock.calls[1]![0]).toBe('/admin/products/created')
  expect(request.mock.calls[1]![1].method).toBe('PUT')
})

test('сохранение одного раздела не стирает правки другого', async () => {
  request.mockResolvedValue({})
  render(<CategoriesEditor data={data} refresh={async () => data} />)
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Название' })[1]!, {
    target: { value: 'Непотерянная правка' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'Сохранить' })[0]!)
  await waitFor(() => expect(request).toHaveBeenCalledOnce())
  expect(screen.getAllByRole('textbox', { name: 'Название' })[1]).toHaveValue('Непотерянная правка')
})

test('поздняя загрузка изображения не заменяет вручную введённую ссылку', async () => {
  let finish!: (value: { url: string }) => void
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const change = vi.fn()
  render(<ImageField label="Фото" value="" onChange={change} />)
  fireEvent.change(screen.getByLabelText('Загрузить фото'), {
    target: { files: [new File(['test'], 'image.png', { type: 'image/png' })] },
  })
  const signal = request.mock.calls[0]![1].signal as AbortSignal
  fireEvent.change(screen.getByRole('textbox', { name: 'Фото' }), {
    target: { value: '/manual.png' },
  })
  await act(async () => finish({ url: '/late-upload.png' }))
  expect(signal.aborted).toBe(true)
  expect(change).toHaveBeenCalledExactlyOnceWith('/manual.png')
})
