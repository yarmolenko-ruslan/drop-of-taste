import { useRef, useState, type FormEvent } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import styles from './AdminScreen.module.css'
import type { Dashboard, Product } from './adminTypes'
import { publishSiteUpdate } from '../../shared/lib/siteUpdates'
import { errorMessage } from './adminUtils'
import { TextField, ImageField } from './AdminFields'

const blankProduct = (categoryId: string): Product => ({
  _id: '',
  categoryId,
  sortOrder: 0,
  name: '',
  details: '',
  description: '',
  image: '',
  imageAlt: '',
  badges: [],
  action: 'add',
  measure: 'г',
  amount: null,
  calories: null,
  ingredients: [],
  allergenNote: '',
  extras: [],
  portions: '',
  priceKopecks: 0,
  available: true,
})

export function CategoriesEditor({
  data,
  refresh,
}: {
  data: Dashboard
  refresh: () => Promise<Dashboard>
}) {
  const [drafts, setDrafts] = useState(data.categories)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function action(path: string, method: string, body?: unknown) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    const submitted = drafts
    try {
      await apiRequest(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      publishSiteUpdate('catalog')
      const next = await refresh()
      setDrafts((current) =>
        next.categories.map((server) => {
          const local = current.find((item) => item._id === server._id)
          if (!local) return server
          if (method !== 'PUT' || !path.endsWith(`/${server._id}`)) return local
          const sent = submitted.find((item) => item._id === server._id)
          return {
            ...server,
            ...(sent && local.title !== sent.title && { title: local.title }),
            ...(sent && local.subtitle !== sent.subtitle && { subtitle: local.subtitle }),
            ...(sent && local.sortOrder !== sent.sortOrder && { sortOrder: local.sortOrder }),
          }
        }),
      )
      setMessage('Категории обновлены')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <div className={styles.editor}>
      <h2>Разделы меню</h2>
      <p>
        Порядок задаётся числом: меньшие числа показываются раньше. Категорию с товарами сначала
        освободите.
      </p>
      {drafts.map((category, index) => (
        <div className={styles.panel} key={category._id}>
          <div className={styles.grid}>
            <TextField
              label="Название"
              value={category.title}
              onChange={(v) =>
                setDrafts(drafts.map((item, i) => (i === index ? { ...item, title: v } : item)))
              }
            />
            <TextField
              label="Подзаголовок"
              value={category.subtitle}
              onChange={(v) =>
                setDrafts(drafts.map((item, i) => (i === index ? { ...item, subtitle: v } : item)))
              }
            />
            <label className={styles.field}>
              <span>Порядок</span>
              <input
                type="number"
                min="0"
                value={category.sortOrder}
                onChange={(e) =>
                  setDrafts(
                    drafts.map((item, i) =>
                      i === index ? { ...item, sortOrder: Number(e.target.value) } : item,
                    ),
                  )
                }
              />
            </label>
          </div>
          <div className={styles.row}>
            <button
              disabled={busy}
              type="button"
              onClick={() =>
                void action(`/admin/categories/${category._id}`, 'PUT', {
                  title: category.title,
                  subtitle: category.subtitle,
                  sortOrder: category.sortOrder,
                })
              }
            >
              Сохранить
            </button>
            <button
              disabled={busy}
              type="button"
              className={styles.danger}
              onClick={() => {
                if (window.confirm(`Удалить раздел «${category.title}»?`))
                  void action(`/admin/categories/${category._id}`, 'DELETE')
              }}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
      <button
        disabled={busy}
        type="button"
        className={styles.secondary}
        onClick={() =>
          void action('/admin/categories', 'POST', {
            title: 'Новый раздел',
            subtitle: '',
            sortOrder: drafts.length,
          })
        }
      >
        Добавить раздел
      </button>
      <p role="status">{message}</p>
    </div>
  )
}

export function ProductsEditor({
  data,
  refresh,
}: {
  data: Dashboard
  refresh: () => Promise<Dashboard>
}) {
  const [selectedId, setSelectedId] = useState('')
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [ingredientsText, setIngredientsText] = useState('')
  const [extrasText, setExtrasText] = useState('')
  const [product, setProduct] = useState<Product>(() => blankProduct(data.categories[0]?._id ?? ''))
  const [message, setMessage] = useState('')
  const set = <K extends keyof Product>(key: K, value: Product[K]) =>
    setProduct((old) => ({ ...old, [key]: value }))
  function select(id: string) {
    if (pending.current) return
    const next = data.products.find((item) => item._id === id)
    setIngredientsText(next?.ingredients.join(', ') ?? '')
    setExtrasText(next?.extras.join(', ') ?? '')
    setSelectedId(id)
    setProduct(
      data.products.find((item) => item._id === id) ?? blankProduct(data.categories[0]?._id ?? ''),
    )
    setMessage('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setMessage('')
    const split = (text: string) =>
      text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    try {
      const result = await apiRequest<{ product: Product }>(
        selectedId ? `/admin/products/${selectedId}` : '/admin/products',
        {
          method: selectedId ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...product,
            ingredients: split(ingredientsText),
            extras: split(extrasText),
          }),
        },
      )
      publishSiteUpdate('catalog')
      setSelectedId(result.product._id)
      setProduct(result.product)
      setIngredientsText(result.product.ingredients.join(', '))
      setExtrasText(result.product.extras.join(', '))
      setMessage('Карточка сохранена и обновлена на сайте')
      await refresh().catch(() =>
        setMessage('Карточка сохранена. Не удалось обновить список — откройте раздел заново.'),
      )
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  async function remove() {
    if (pending.current || !selectedId || !window.confirm(`Удалить «${product.name}»?`)) return
    pending.current = true
    setBusy(true)
    try {
      await apiRequest(`/admin/products/${selectedId}`, { method: 'DELETE' })
      publishSiteUpdate('catalog')
      setSelectedId('')
      setProduct(blankProduct(data.categories[0]?._id ?? ''))
      setIngredientsText('')
      setExtrasText('')
      setMessage('Карточка удалена')
      await refresh().catch(() =>
        setMessage('Карточка удалена. Не удалось обновить список — откройте раздел заново.'),
      )
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <div className={styles.productsLayout}>
      <aside className={styles.productList}>
        <button type="button" onClick={() => select('')}>
          + Новый товар
        </button>
        {data.categories.map((category) => (
          <div key={category._id}>
            <h3>{category.title}</h3>
            {data.products
              .filter((item) => item.categoryId === category._id)
              .map((item) => (
                <button
                  className={selectedId === item._id ? styles.selected : ''}
                  type="button"
                  key={item._id}
                  onClick={() => select(item._id)}
                >
                  {item.name}
                </button>
              ))}
          </div>
        ))}
      </aside>
      <form className={styles.editor} onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} className={styles.editorFields}>
          <div className={styles.actions}>
            <button type="submit" disabled={busy || !data.categories.length}>
              {busy ? 'Сохраняем…' : 'Сохранить товар'}
            </button>
            <span role="status">{message}</span>
          </div>
          <h2>{selectedId ? 'Редактировать товар' : 'Новый товар'}</h2>
          <div className={styles.grid}>
            <TextField label="Название" value={product.name} onChange={(v) => set('name', v)} />
            <label className={styles.field}>
              <span>Раздел</span>
              <select
                value={product.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                {data.categories.map((item) => (
                  <option value={item._id} key={item._id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Действие карточки</span>
              <select
                value={product.action}
                onChange={(e) => set('action', e.target.value as Product['action'])}
              >
                <option value="add">Добавить в корзину</option>
                <option value="choose">Открыть карточку для выбора</option>
              </select>
            </label>
            <TextField
              label="Короткое описание"
              value={product.details}
              onChange={(v) => set('details', v)}
            />
            <label className={styles.field}>
              <span>Цена, ₽</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={product.priceKopecks / 100}
                onChange={(e) => set('priceKopecks', Math.round(Number(e.target.value) * 100))}
              />
            </label>
            <label className={styles.field}>
              <span>Порядок</span>
              <input
                type="number"
                min="0"
                value={product.sortOrder}
                onChange={(e) => set('sortOrder', Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span>Вес / объём</span>
              <input
                type="number"
                min="0"
                value={product.amount ?? ''}
                onChange={(e) =>
                  set('amount', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </label>
            <label className={styles.field}>
              <span>Единица</span>
              <select
                value={product.measure}
                onChange={(e) => set('measure', e.target.value as Product['measure'])}
              >
                <option>г</option>
                <option>мл</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Калорийность</span>
              <input
                type="number"
                min="0"
                value={product.calories ?? ''}
                onChange={(e) =>
                  set('calories', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </label>
          </div>
          <TextField
            label="Полное описание"
            value={product.description}
            onChange={(v) => set('description', v)}
            multiline
          />
          <ImageField
            key={selectedId}
            label="Фото товара"
            value={product.image}
            onChange={(v) => set('image', v)}
          />
          <TextField
            label="Описание фото"
            value={product.imageAlt}
            onChange={(v) => set('imageAlt', v)}
          />
          <div className={styles.grid}>
            <TextField
              label="Состав, через запятую"
              value={ingredientsText}
              onChange={setIngredientsText}
            />
            <TextField label="Добавки, через запятую" value={extrasText} onChange={setExtrasText} />
            <TextField
              label="Аллергены"
              value={product.allergenNote ?? ''}
              onChange={(v) => set('allergenNote', v)}
            />
            <TextField
              label="Порции набора"
              value={product.portions ?? ''}
              onChange={(v) => set('portions', v)}
            />
          </div>
          <fieldset className={styles.checks}>
            <legend>Метки</legend>
            {(['new', 'lenten', 'hit', 'spicy', 'discount'] as const).map((badge) => (
              <label key={badge}>
                <input
                  type="checkbox"
                  checked={product.badges.includes(badge)}
                  onChange={(e) =>
                    set(
                      'badges',
                      e.target.checked
                        ? [...product.badges, badge]
                        : product.badges.filter((item) => item !== badge),
                    )
                  }
                />
                {
                  {
                    new: 'Новинка',
                    lenten: 'Постное',
                    hit: 'Хит',
                    spicy: 'Острое',
                    discount: 'Скидка',
                  }[badge]
                }
              </label>
            ))}
          </fieldset>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={product.available}
              onChange={(e) => set('available', e.target.checked)}
            />
            Доступен для заказа
          </label>
          <div className={styles.actions}>
            <button type="submit" disabled={busy || !data.categories.length}>
              {busy ? 'Сохраняем…' : 'Сохранить товар'}
            </button>
            {selectedId && (
              <button type="button" className={styles.danger} onClick={() => void remove()}>
                Удалить товар
              </button>
            )}
            <span role="status">{message}</span>
          </div>
        </fieldset>
      </form>
    </div>
  )
}
