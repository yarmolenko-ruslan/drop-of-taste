import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { apiRequest } from '../../features/auth/api/authApi'
import type { SiteContent } from '../../../shared/site-content'
import { formatRussianPhone, formatRussianPhoneInput } from '../../../shared/validation/phone'
import type { BonusCode } from '../../../shared/bonus-code'
import styles from './AdminScreen.module.css'
import { publishSiteUpdate } from '../../shared/lib/siteUpdates'
import { OrdersEditor, ClientsEditor } from './AdminOperations'

type Category = { _id: string; title: string; subtitle: string; sortOrder: number }
type Product = {
  _id: string
  categoryId: string
  sortOrder: number
  name: string
  details: string
  description: string
  image: string
  imageAlt: string
  badges: string[]
  action: 'add' | 'choose'
  measure: 'г' | 'мл'
  amount: number | null
  calories: number | null
  ingredients: string[]
  allergenNote: string
  extras: string[]
  portions: string
  priceKopecks: number
  available: boolean
}
type Dashboard = {
  content: SiteContent
  categories: Category[]
  products: Product[]
  iikoConfigured: boolean
}
type Tab =
  | 'orders'
  | 'clients'
  | 'content'
  | 'promotions'
  | 'codes'
  | 'categories'
  | 'products'
  | 'legal'
  | 'logs'
  | 'iiko'

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
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить изменения'

const localDate = (iso?: string) =>
  iso
    ? new Date(iso)
        .toLocaleString('sv-SE', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        .replace(' ', 'T')
    : ''
const isoDate = (value: string) => (value ? new Date(value).toISOString() : undefined)

function changedContentFields(
  current: SiteContent,
  initial: SiteContent,
  include: (key: keyof SiteContent) => boolean,
): Partial<SiteContent> {
  const changed: Partial<SiteContent> = {}
  for (const key of Object.keys(current) as (keyof SiteContent)[]) {
    if (include(key) && JSON.stringify(current[key]) !== JSON.stringify(initial[key]))
      Object.assign(changed, { [key]: current[key] })
  }
  return changed
}

function ImageField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function upload(file: File) {
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest<{ url: string }>('/admin/upload', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      onChange(result.url)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.imageRow}>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="/uploads/… или https://…"
        />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label={`Загрузить ${label.toLowerCase()}`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
      </span>
      {busy && <small>Загрузка…</small>}
      {error && <small className={styles.error}>{error}</small>}
      {value && <img className={styles.preview} src={value} alt="Предпросмотр" />}
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  type?: string
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  )
}

function PhoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>Телефон</span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={formatRussianPhone(value)}
        placeholder="+7 (999) 888-77-66"
        pattern="\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}"
        title="Введите номер в формате +7 (999) 888-77-66"
        onChange={(event) =>
          onChange(
            event.target.value.trim()
              ? formatRussianPhoneInput(event.target.value, formatRussianPhone(value))
              : '',
          )
        }
      />
    </label>
  )
}

function ContentEditor({
  initial,
  onSaved,
  section = 'site',
}: {
  initial: SiteContent
  onSaved: (content: SiteContent) => void
  section?: 'site' | 'promotions'
}) {
  const [content, setContent] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const set = <K extends keyof SiteContent>(key: K, value: SiteContent[K]) =>
    setContent((old) => ({ ...old, [key]: value }))
  async function save(event: FormEvent) {
    event.preventDefault()
    const changes = changedContentFields(content, saved, (key) =>
      section === 'promotions'
        ? key === 'promotions'
        : key !== 'legal' && key !== 'legalRevision' && key !== 'promotions',
    )
    if (Object.keys(changes).length === 0) {
      setMessage('Изменений нет')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await apiRequest<{ content: SiteContent }>('/admin/content', {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      setSaved(result.content)
      setContent((current) => ({
        ...result.content,
        ...changedContentFields(current, content, () => true),
      }))
      setMessage('Сохранено. Изменения уже видны на сайте.')
      onSaved(result.content)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className={styles.editor}>
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : section === 'promotions' ? 'Сохранить акции' : 'Сохранить сайт'}
        </button>
        <span role="status">{message}</span>
      </div>
      {section === 'site' && (
        <>
          <h2>Контакты и оформление</h2>
          <div className={styles.grid}>
            <TextField
              label="Название кафе"
              value={content.brandName}
              onChange={(v) => set('brandName', v)}
            />
            <TextField
              label="Заголовок главной страницы"
              value={content.siteTitle}
              onChange={(v) => set('siteTitle', v)}
            />
            <TextField
              label="Название вкладки браузера"
              value={content.browserTitle}
              onChange={(v) => set('browserTitle', v)}
            />
            <TextField
              label="Подпись под логотипом"
              value={content.tagline}
              onChange={(v) => set('tagline', v)}
            />
            <PhoneField value={content.phone} onChange={(v) => set('phone', v)} />
            <TextField label="Почта" value={content.email} onChange={(v) => set('email', v)} />
            <TextField label="Адрес" value={content.address} onChange={(v) => set('address', v)} />
            <TextField
              label="Время работы"
              value={content.hours}
              onChange={(v) => set('hours', v)}
            />
            <TextField
              label="Ссылка карты для сайта"
              value={content.mapEmbedUrl}
              onChange={(v) => set('mapEmbedUrl', v)}
            />
            <TextField
              label="Ссылка для построения маршрута"
              value={content.mapRouteUrl}
              onChange={(v) => set('mapRouteUrl', v)}
            />
            <TextField label="Ссылка VK" value={content.vkUrl} onChange={(v) => set('vkUrl', v)} />
            <TextField
              label="Ссылка Telegram"
              value={content.telegramUrl}
              onChange={(v) => set('telegramUrl', v)}
            />
          </div>
          <ImageField
            label="Логотип"
            value={content.brandLogo}
            onChange={(v) => set('brandLogo', v)}
          />
          <TextField
            label="Текст в подвале"
            value={content.footerDescription}
            onChange={(v) => set('footerDescription', v)}
            multiline
          />
          <TextField
            label="Юридические реквизиты в подвале"
            value={content.legalDetails}
            onChange={(v) => set('legalDetails', v)}
            multiline
          />
          <h2>Главная и страница кафе</h2>
          <TextField
            label="Заголовок о кафе"
            value={content.aboutLead}
            onChange={(v) => set('aboutLead', v)}
          />
          <div className={styles.grid}>
            <TextField
              label="Название страницы кафе"
              value={content.aboutPageTitle}
              onChange={(v) => set('aboutPageTitle', v)}
            />
            <TextField
              label="Надпись над названием"
              value={content.aboutEyebrow}
              onChange={(v) => set('aboutEyebrow', v)}
            />
            <TextField
              label="Описание фотографии для доступности"
              value={content.aboutImageAlt}
              onChange={(v) => set('aboutImageAlt', v)}
            />
            <TextField
              label="Заголовок адреса"
              value={content.visitTitle}
              onChange={(v) => set('visitTitle', v)}
            />
            <TextField
              label="Заголовок преимуществ"
              value={content.highlightsTitle}
              onChange={(v) => set('highlightsTitle', v)}
            />
            <TextField
              label="Заголовок карты"
              value={content.mapTitle}
              onChange={(v) => set('mapTitle', v)}
            />
          </div>
          <TextField
            label="Первый абзац о кафе"
            value={content.aboutParagraphs[0]}
            onChange={(v) => set('aboutParagraphs', [v, content.aboutParagraphs[1]])}
            multiline
          />
          <TextField
            label="Второй абзац о кафе"
            value={content.aboutParagraphs[1]}
            onChange={(v) => set('aboutParagraphs', [content.aboutParagraphs[0], v])}
            multiline
          />
          <TextField
            label="Короткий текст на главной"
            value={content.homeAboutText}
            onChange={(v) => set('homeAboutText', v)}
            multiline
          />
          <ImageField
            label="Фото кафе"
            value={content.aboutImage}
            onChange={(v) => set('aboutImage', v)}
          />
          <TextField
            label="Заголовок блока личного кабинета"
            value={content.bonusTitle}
            onChange={(v) => set('bonusTitle', v)}
          />
          <TextField
            label="Текст блока личного кабинета"
            value={content.bonusText}
            onChange={(v) => set('bonusText', v)}
            multiline
          />
          {content.bonusSteps.map((step, index) => (
            <TextField
              key={index}
              label={`Шаг блока личного кабинета ${index + 1}`}
              value={step}
              onChange={(v) =>
                set(
                  'bonusSteps',
                  content.bonusSteps.map((old, i) =>
                    i === index ? v : old,
                  ) as SiteContent['bonusSteps'],
                )
              }
            />
          ))}
          <div className={styles.grid}>
            <TextField
              label="Заголовок комбо"
              value={content.comboTitle}
              onChange={(v) => set('comboTitle', v)}
            />
            <TextField
              label="Подзаголовок комбо"
              value={content.comboSubtitle}
              onChange={(v) => set('comboSubtitle', v)}
            />
            <TextField
              label="Метка на комбо"
              value={content.comboBadge}
              onChange={(v) => set('comboBadge', v)}
            />
            <TextField
              label="Условие для комбо"
              value={content.comboNote}
              onChange={(v) => set('comboNote', v)}
            />
            <TextField
              label="Подзаголовок соусов"
              value={content.saucesSubtitle}
              onChange={(v) => set('saucesSubtitle', v)}
            />
          </div>
          {content.aboutHighlights.map((item, index) => (
            <TextField
              key={index}
              label={`Пункт «Что вас ждёт» ${index + 1}`}
              value={item}
              onChange={(v) =>
                set(
                  'aboutHighlights',
                  content.aboutHighlights.map((old, i) =>
                    i === index ? v : old,
                  ) as SiteContent['aboutHighlights'],
                )
              }
            />
          ))}
          <h2>Условия на главной</h2>
          {content.benefits.map((benefit, index) => (
            <div className={styles.grid} key={benefit.icon}>
              <TextField
                label={`${index + 1}. Заголовок`}
                value={benefit.title}
                onChange={(v) =>
                  set(
                    'benefits',
                    content.benefits.map((old, i) => (i === index ? { ...old, title: v } : old)),
                  )
                }
              />
              <TextField
                label="Пояснение"
                value={benefit.detail}
                onChange={(v) =>
                  set(
                    'benefits',
                    content.benefits.map((old, i) => (i === index ? { ...old, detail: v } : old)),
                  )
                }
              />
            </div>
          ))}
          <h2>Баннеры</h2>
          {content.heroSlides.map((slide, index) => (
            <div className={styles.panel} key={slide.id + index}>
              <div className={styles.row}>
                <h3>Баннер {index + 1}</h3>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={content.heroSlides.length === 1}
                  onClick={() =>
                    set(
                      'heroSlides',
                      content.heroSlides.filter((_, i) => i !== index),
                    )
                  }
                >
                  Удалить
                </button>
              </div>
              <ImageField
                label="Баннер целиком (изображение с текстом)"
                value={slide.image}
                onChange={(v) =>
                  set(
                    'heroSlides',
                    content.heroSlides.map((s, i) => (i === index ? { ...s, image: v } : s)),
                  )
                }
              />
              <TextField
                label="Описание картинки для доступности"
                value={slide.imageAlt}
                onChange={(v) =>
                  set(
                    'heroSlides',
                    content.heroSlides.map((s, i) => (i === index ? { ...s, imageAlt: v } : s)),
                  )
                }
              />
              <label className={styles.field}>
                <span>Куда ведёт картинка</span>
                <select
                  value={
                    slide.href ??
                    (content.promotions.some((promotion) => promotion.id === slide.id)
                      ? `/promotions/${slide.id}`
                      : '/promotions')
                  }
                  onChange={(event) =>
                    set(
                      'heroSlides',
                      content.heroSlides.map((item, i) =>
                        i === index ? { ...item, href: event.target.value } : item,
                      ),
                    )
                  }
                >
                  <option value="/promotions">Все акции</option>
                  <option value="/about">О кафе</option>
                  {content.promotions.map((promotion) => (
                    <option key={promotion.id} value={`/promotions/${promotion.id}`}>
                      {promotion.subtitle}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <button
            type="button"
            className={styles.secondary}
            disabled={content.heroSlides.length >= 12}
            onClick={() =>
              set('heroSlides', [
                ...content.heroSlides,
                {
                  id: crypto.randomUUID(),
                  badge: '',
                  title: '',
                  description: '',
                  image: content.aboutImage,
                  imageAlt: '',
                  href: '/promotions',
                },
              ])
            }
          >
            Добавить баннер
          </button>
        </>
      )}
      {section === 'promotions' && (
        <>
          <h2>Акции на отдельной странице</h2>
          <p>
            Акции самовывоза меняют цену заказа по указанному ниже проценту. Остальные карточки
            показывают условия; их скидки и подарки не применяются к онлайн-заказу автоматически.
          </p>
          {content.promotions.map((promotion, index) => (
            <div className={styles.panel} key={promotion.id}>
              <div className={styles.row}>
                <h3>Акция {index + 1}</h3>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() =>
                    set(
                      'promotions',
                      content.promotions.filter((_, i) => i !== index),
                    )
                  }
                >
                  Удалить
                </button>
              </div>
              <div className={styles.grid}>
                <TextField
                  label="Метка"
                  value={promotion.badge}
                  onChange={(v) =>
                    set(
                      'promotions',
                      content.promotions.map((old, i) =>
                        i === index ? { ...old, badge: v } : old,
                      ),
                    )
                  }
                />
                <TextField
                  label="Крупный текст"
                  value={promotion.title}
                  onChange={(v) =>
                    set(
                      'promotions',
                      content.promotions.map((old, i) =>
                        i === index ? { ...old, title: v } : old,
                      ),
                    )
                  }
                />
                <TextField
                  label="Заголовок"
                  value={promotion.subtitle}
                  onChange={(v) =>
                    set(
                      'promotions',
                      content.promotions.map((old, i) =>
                        i === index ? { ...old, subtitle: v } : old,
                      ),
                    )
                  }
                />
                <TextField
                  label="Текст кнопки"
                  value={promotion.action}
                  onChange={(v) =>
                    set(
                      'promotions',
                      content.promotions.map((old, i) =>
                        i === index ? { ...old, action: v } : old,
                      ),
                    )
                  }
                />
              </div>
              <TextField
                label="Описание"
                value={promotion.description}
                onChange={(v) =>
                  set(
                    'promotions',
                    content.promotions.map((old, i) =>
                      i === index ? { ...old, description: v } : old,
                    ),
                  )
                }
                multiline
              />
              <TextField
                label="Условия"
                value={promotion.conditions}
                onChange={(v) =>
                  set(
                    'promotions',
                    content.promotions.map((old, i) =>
                      i === index ? { ...old, conditions: v } : old,
                    ),
                  )
                }
                multiline
              />
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Раздел</span>
                  <select
                    value={promotion.category}
                    onChange={(e) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) =>
                          i === index
                            ? { ...old, category: e.target.value as typeof old.category }
                            : old,
                        ),
                      )
                    }
                  >
                    <option value="delivery">Доставка</option>
                    <option value="pickup">Самовывоз</option>
                    <option value="cafe">В кафе</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Цвет</span>
                  <select
                    value={promotion.theme}
                    onChange={(e) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) =>
                          i === index ? { ...old, theme: e.target.value as typeof old.theme } : old,
                        ),
                      )
                    }
                  >
                    {['red', 'cream', 'burgundy', 'gold', 'green', 'white'].map((color) => (
                      <option value={color} key={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {promotion.category === 'pickup' && (
                <label className={styles.field}>
                  <span>Скидка на блюда при самовывозе, %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={promotion.discountPercent ?? (promotion.id === 'pickup' ? 10 : 0)}
                    onChange={(event) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) => {
                          if (i !== index) return old
                          const discountPercent = Number(event.target.value)
                          return {
                            ...old,
                            discountPercent,
                            title: /^−\d+(?:[.,]\d+)?%$/.test(old.title)
                              ? `−${discountPercent}%`
                              : old.title,
                          }
                        }),
                      )
                    }
                  />
                  <small>
                    Комбо и наборы не участвуют. Если действует несколько акций самовывоза,
                    применяется наибольшая скидка. Проверьте текст условий после изменения процента.
                  </small>
                </label>
              )}
              <TextField
                label="Ссылка кнопки (пусто — открыть вход)"
                value={promotion.href ?? ''}
                onChange={(v) =>
                  set(
                    'promotions',
                    content.promotions.map((old, i) => (i === index ? { ...old, href: v } : old)),
                  )
                }
              />
              <div className={styles.grid}>
                <TextField
                  label="Начало акции"
                  type="datetime-local"
                  value={localDate(promotion.startsAt)}
                  onChange={(v) =>
                    set(
                      'promotions',
                      content.promotions.map((old, i) =>
                        i === index ? { ...old, startsAt: isoDate(v) } : old,
                      ),
                    )
                  }
                />
                <TextField
                  label="Окончание акции"
                  type="datetime-local"
                  value={localDate(promotion.endsAt)}
                  onChange={(v) =>
                    set(
                      'promotions',
                      content.promotions.map((old, i) =>
                        i === index ? { ...old, endsAt: isoDate(v) } : old,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className={styles.secondary}
            disabled={content.promotions.length >= 30}
            onClick={() =>
              set('promotions', [
                ...content.promotions,
                {
                  id: crypto.randomUUID(),
                  category: 'cafe',
                  badge: 'НОВОЕ',
                  title: 'Акция',
                  subtitle: 'Новая акция',
                  description: 'Описание',
                  conditions: 'Условия',
                  action: 'В меню',
                  href: '/',
                  theme: 'cream',
                },
              ])
            }
          >
            Добавить акцию
          </button>
        </>
      )}
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : section === 'promotions' ? 'Сохранить акции' : 'Сохранить сайт'}
        </button>
        <span role="status">{message}</span>
      </div>
    </form>
  )
}

function LegalEditor({
  initial,
  onSaved,
}: {
  initial: SiteContent
  onSaved: (content: SiteContent) => void
}) {
  const [content, setContent] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const change = (variant: 'privacy' | 'consent', page: SiteContent['legal']['privacy']) =>
    setContent((old) => ({ ...old, legal: { ...old.legal, [variant]: page } }))
  async function save(event: FormEvent) {
    event.preventDefault()
    const changes = changedContentFields(
      content,
      saved,
      (key) => key === 'legal' || key === 'legalRevision',
    )
    if (Object.keys(changes).length === 0) {
      setMessage('Изменений нет')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const result = await apiRequest<{ content: SiteContent }>('/admin/content', {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      setSaved(result.content)
      setContent((current) => ({
        ...result.content,
        ...changedContentFields(current, content, () => true),
      }))
      setMessage('Документы сохранены и обновлены на сайте')
      onSaved(result.content)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={styles.editor} onSubmit={(event) => void save(event)}>
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : 'Сохранить документы'}
        </button>
        <span role="status">{message}</span>
      </div>
      <h2>Юридические страницы</h2>
      <p>
        Изменяя текст согласия, задайте новую редакцию. Эта редакция сохраняется при следующем входе
        посетителя.
      </p>
      <TextField
        label="Редакция согласия (например, 2026-11-07)"
        value={content.legalRevision}
        onChange={(v) => setContent((old) => ({ ...old, legalRevision: v }))}
      />
      {(['privacy', 'consent'] as const).map((variant) => {
        const page = content.legal[variant]
        return (
          <section key={variant} className={styles.panel}>
            <h2>
              {variant === 'privacy'
                ? 'Политика конфиденциальности'
                : 'Согласие на обработку данных'}
            </h2>
            <TextField
              label="Заголовок"
              value={page.title}
              onChange={(v) => change(variant, { ...page, title: v })}
            />
            <TextField
              label="Вводный текст"
              value={page.intro}
              onChange={(v) => change(variant, { ...page, intro: v })}
              multiline
            />
            {page.sections.map(([title, body], index) => (
              <div className={styles.panel} key={index}>
                <div className={styles.row}>
                  <h3>Раздел {index + 1}</h3>
                  <button
                    className={styles.danger}
                    type="button"
                    disabled={page.sections.length === 1}
                    onClick={() =>
                      change(variant, {
                        ...page,
                        sections: page.sections.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Удалить
                  </button>
                </div>
                <TextField
                  label="Заголовок раздела"
                  value={title}
                  onChange={(v) =>
                    change(variant, {
                      ...page,
                      sections: page.sections.map((old, i) => (i === index ? [v, old[1]] : old)),
                    })
                  }
                />
                <TextField
                  label="Текст раздела"
                  value={body}
                  onChange={(v) =>
                    change(variant, {
                      ...page,
                      sections: page.sections.map((old, i) => (i === index ? [old[0], v] : old)),
                    })
                  }
                  multiline
                />
              </div>
            ))}
            <button
              className={styles.secondary}
              type="button"
              disabled={page.sections.length >= 30}
              onClick={() =>
                change(variant, {
                  ...page,
                  sections: [...page.sections, ['Новый раздел', 'Текст раздела']],
                })
              }
            >
              Добавить раздел
            </button>
          </section>
        )
      })}
      <div className={styles.actions}>
        <button disabled={busy} type="submit">
          {busy ? 'Сохраняем…' : 'Сохранить документы'}
        </button>
        <span role="status">{message}</span>
      </div>
    </form>
  )
}

function CategoriesEditor({
  data,
  refresh,
}: {
  data: Dashboard
  refresh: () => Promise<Dashboard>
}) {
  const [drafts, setDrafts] = useState(data.categories)
  const [message, setMessage] = useState('')
  async function action(path: string, method: string, body?: unknown) {
    try {
      await apiRequest(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
      publishSiteUpdate('catalog')
      const next = await refresh()
      setDrafts(next.categories)
      setMessage('Категории обновлены')
    } catch (error) {
      setMessage(errorMessage(error))
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

function ProductsEditor({ data, refresh }: { data: Dashboard; refresh: () => Promise<Dashboard> }) {
  const [selectedId, setSelectedId] = useState('')
  const [product, setProduct] = useState<Product>(() => blankProduct(data.categories[0]?._id ?? ''))
  const [message, setMessage] = useState('')
  const set = <K extends keyof Product>(key: K, value: Product[K]) =>
    setProduct((old) => ({ ...old, [key]: value }))
  function select(id: string) {
    setSelectedId(id)
    setProduct(
      data.products.find((item) => item._id === id) ?? blankProduct(data.categories[0]?._id ?? ''),
    )
    setMessage('')
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    try {
      const result = await apiRequest<{ product: Product }>(
        selectedId ? `/admin/products/${selectedId}` : '/admin/products',
        { method: selectedId ? 'PUT' : 'POST', body: JSON.stringify(product) },
      )
      publishSiteUpdate('catalog')
      await refresh()
      setSelectedId(result.product._id)
      setProduct(result.product)
      setMessage('Карточка сохранена и обновлена на сайте')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }
  async function remove() {
    if (!selectedId || !window.confirm(`Удалить «${product.name}»?`)) return
    try {
      await apiRequest(`/admin/products/${selectedId}`, { method: 'DELETE' })
      publishSiteUpdate('catalog')
      await refresh()
      select('')
      setMessage('Карточка удалена')
    } catch (error) {
      setMessage(errorMessage(error))
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
        <div className={styles.actions}>
          <button type="submit">Сохранить товар</button>
          <span role="status">{message}</span>
        </div>
        <h2>{selectedId ? 'Редактировать товар' : 'Новый товар'}</h2>
        <div className={styles.grid}>
          <TextField label="Название" value={product.name} onChange={(v) => set('name', v)} />
          <label className={styles.field}>
            <span>Раздел</span>
            <select value={product.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
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
              onChange={(e) => set('amount', e.target.value === '' ? null : Number(e.target.value))}
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
        <ImageField label="Фото товара" value={product.image} onChange={(v) => set('image', v)} />
        <TextField
          label="Описание фото"
          value={product.imageAlt}
          onChange={(v) => set('imageAlt', v)}
        />
        <div className={styles.grid}>
          <TextField
            label="Состав, через запятую"
            value={product.ingredients.join(', ')}
            onChange={(v) =>
              set(
                'ingredients',
                v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
          <TextField
            label="Добавки, через запятую"
            value={product.extras.join(', ')}
            onChange={(v) =>
              set(
                'extras',
                v
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
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
          <button type="submit">Сохранить товар</button>
          {selectedId && (
            <button type="button" className={styles.danger} onClick={() => void remove()}>
              Удалить товар
            </button>
          )}
          <span role="status">{message}</span>
        </div>
      </form>
    </div>
  )
}

function IikoEditor({
  configured,
  refresh,
}: {
  configured: boolean
  refresh: () => Promise<Dashboard>
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function sync() {
    setBusy(true)
    setMessage('')
    try {
      const result = await apiRequest<{ imported: number; updated: number; skipped: number }>(
        '/admin/iiko/sync',
        {
          method: 'POST',
        },
        60_000,
      )
      publishSiteUpdate('catalog')
      await refresh()
      setMessage(
        `Готово: добавлено ${result.imported}, обновлено ${result.updated}, пропущено ${result.skipped} сложных или скрытых блюд. Витрина обновлена.`,
      )
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.editor}>
      <h2>iiko</h2>
      <p>
        iiko может передавать внешнее меню: разделы, блюда, цены и фотографии. Позиции, пропавшие из
        следующей полной выгрузки, становятся недоступными. Отдельные стоп-листы пока не
        загружаются.
      </p>
      <p>
        Статус: <strong>{configured ? 'ключи указаны на сервере' : 'ключи ещё не указаны'}</strong>
      </p>
      <p>
        Чтобы подключить, внесите в серверный файл <code>.env</code> значения{' '}
        <code>IIKO_APP_ID</code>, <code>IIKO_CLIENT_SECRET</code>, <code>IIKO_API_KEY</code>,{' '}
        <code>IIKO_ORGANIZATION_ID</code> и <code>IIKO_EXTERNAL_MENU_ID</code>. Затем перезапустите
        API.
      </p>
      <p>
        Импорт запускается вручную. Существующие карточки сохраняют тексты и фото, которые вы
        изменили в панели; цены из iiko обновляются.
      </p>
      <button type="button" disabled={!configured || busy} onClick={() => void sync()}>
        {busy ? 'Загружаем…' : 'Загрузить меню из iiko'}
      </button>
      <p role="status">{message}</p>
    </div>
  )
}

function BonusCodesEditor() {
  const [codes, setCodes] = useState<BonusCode[]>([])
  const [draft, setDraft] = useState<BonusCode>({
    _id: '',
    kind: 'percent',
    value: 10,
    startsAt: '',
    endsAt: '',
    active: true,
  })
  const [existing, setExisting] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function refresh() {
    const response = await apiRequest<{ codes: BonusCode[] }>('/admin/bonus-codes')
    setCodes(response.codes)
  }
  useEffect(() => {
    apiRequest<{ codes: BonusCode[] }>('/admin/bonus-codes')
      .then((response) => setCodes(response.codes))
      .catch((error) => setMessage(errorMessage(error)))
  }, [])
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (
        !draft.startsAt ||
        !draft.endsAt ||
        Date.parse(draft.startsAt) >= Date.parse(draft.endsAt)
      )
        throw new Error('Укажите правильное время начала и окончания')
      const payload = {
        code: draft._id,
        kind: draft.kind,
        value: draft.value,
        startsAt: draft.startsAt,
        endsAt: draft.endsAt,
        active: draft.active,
      }
      const response = await apiRequest<{ code: BonusCode }>(
        existing ? `/admin/bonus-codes/${encodeURIComponent(draft._id)}` : '/admin/bonus-codes',
        { method: existing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      )
      setDraft(response.code)
      setExisting(true)
      await refresh()
      setMessage('Бонус-код сохранён')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!existing || !window.confirm(`Удалить бонус-код ${draft._id}?`)) return
    setBusy(true)
    try {
      await apiRequest(`/admin/bonus-codes/${encodeURIComponent(draft._id)}`, { method: 'DELETE' })
      setDraft({ _id: '', kind: 'percent', value: 10, startsAt: '', endsAt: '', active: true })
      setExisting(false)
      await refresh()
      setMessage('Бонус-код удалён')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.productsLayout}>
      <aside className={styles.productList}>
        <button
          type="button"
          onClick={() => {
            setDraft({
              _id: '',
              kind: 'percent',
              value: 10,
              startsAt: '',
              endsAt: '',
              active: true,
            })
            setExisting(false)
            setMessage('')
          }}
        >
          + Новый код
        </button>
        {codes.map((code) => (
          <button
            type="button"
            key={code._id}
            className={existing && draft._id === code._id ? styles.selected : ''}
            onClick={() => {
              setDraft(code)
              setExisting(true)
              setMessage('')
            }}
          >
            {code._id}
          </button>
        ))}
      </aside>
      <form className={styles.editor} onSubmit={(event) => void save(event)}>
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить бонус-код'}
          </button>
          <span role="status">{message}</span>
        </div>
        <h2>{existing ? `Бонус-код ${draft._id}` : 'Новый бонус-код'}</h2>
        <label className={styles.field}>
          <span>Код для клиента</span>
          <input
            value={draft._id}
            readOnly={existing}
            required
            onChange={(event) => setDraft({ ...draft, _id: event.target.value.toUpperCase() })}
          />
        </label>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Вид скидки</span>
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as BonusCode['kind'], value: 10 })
              }
            >
              <option value="percent">Проценты</option>
              <option value="rubles">Рубли</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>{draft.kind === 'percent' ? 'Скидка, %' : 'Скидка, ₽'}</span>
            <input
              type="number"
              min="0.01"
              max={draft.kind === 'percent' ? 100 : 1000000}
              step="0.01"
              required
              value={draft.value}
              onChange={(event) => setDraft({ ...draft, value: Number(event.target.value) })}
            />
          </label>
          <TextField
            label="Действует с"
            type="datetime-local"
            value={localDate(draft.startsAt)}
            onChange={(v) => setDraft({ ...draft, startsAt: isoDate(v) ?? '' })}
          />
          <TextField
            label="Действует до"
            type="datetime-local"
            value={localDate(draft.endsAt)}
            onChange={(v) => setDraft({ ...draft, endsAt: isoDate(v) ?? '' })}
          />
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
          />
          Код включён
        </label>
        <p>
          Время указывается по вашему часовому поясу. Код не действует на комбо и наборы. Если
          действует скидка за самовывоз, применяется более выгодная скидка. Стоимость доставки не
          уменьшается.
        </p>
        {existing && (
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => void remove()}
          >
            Удалить код
          </button>
        )}
      </form>
    </div>
  )
}

type AuditEntry = {
  _id: string
  action: string
  id?: string
  at: string
  changes?: { field: string; before: unknown; after: unknown }[]
}
type PaymentEntry = {
  _id: string
  orderId: string
  from: string
  status: string
  paymentId?: string
  amountKopecks: number
  at: string
}
const paymentStatusLabels: Record<string, string> = {
  unpaid: 'Без оплаты',
  creating: 'Создание платежа',
  pending: 'Ожидает оплаты',
  succeeded: 'Оплачено',
  canceled: 'Отменено',
  error: 'Ошибка',
}
const auditActionLabels: Record<string, string> = {
  'content.update': 'Изменён сайт',
  'category.create': 'Создан раздел',
  'category.update': 'Изменён раздел',
  'category.delete': 'Удалён раздел',
  'product.create': 'Создан товар',
  'product.update': 'Изменён товар',
  'product.delete': 'Удалён товар',
  'bonus_code.create': 'Создан бонус-код',
  'bonus_code.update': 'Изменён бонус-код',
  'bonus_code.delete': 'Удалён бонус-код',
  'image.upload': 'Загружено изображение',
  'iiko.sync': 'Импортировано меню iiko',
  'product.iiko_create': 'Товар добавлен из iiko',
  'product.iiko_update': 'Товар обновлён из iiko',
}
const logValue = (value: unknown) =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '—')
function LogsEditor() {
  const [logs, setLogs] = useState<{ changes: AuditEntry[]; payments: PaymentEntry[] } | null>(null)
  const [message, setMessage] = useState('')
  async function refresh() {
    try {
      setLogs(await apiRequest('/admin/logs'))
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }
  useEffect(() => {
    apiRequest<{ changes: AuditEntry[]; payments: PaymentEntry[] }>('/admin/logs')
      .then((response) => setLogs(response))
      .catch((error) => setMessage(errorMessage(error)))
  }, [])
  return (
    <div className={styles.editor}>
      <div className={styles.actions}>
        <button type="button" onClick={() => void refresh()}>
          Обновить журнал
        </button>
        <span role="status">{message}</span>
      </div>
      <h2>Оплаты</h2>
      {!logs ? (
        <p>Загрузка…</p>
      ) : logs.payments.length === 0 ? (
        <p>Платежей пока нет.</p>
      ) : (
        logs.payments.map((item) => (
          <div className={styles.panel} key={item._id}>
            <strong>
              {new Date(item.at).toLocaleString('ru-RU')} · заказ {item.orderId.slice(0, 8)}
            </strong>
            <p>
              {paymentStatusLabels[item.from] ?? item.from} →{' '}
              {paymentStatusLabels[item.status] ?? item.status} ·{' '}
              {(item.amountKopecks / 100).toLocaleString('ru-RU')} ₽
              {item.paymentId ? ` · платёж ${item.paymentId}` : ''}
            </p>
          </div>
        ))
      )}
      <h2>Изменения на сайте</h2>
      {logs?.changes.length === 0 && <p>Изменений пока нет.</p>}
      {logs?.changes.map((item) => (
        <div className={styles.panel} key={item._id}>
          <strong>
            {new Date(item.at).toLocaleString('ru-RU')} ·{' '}
            {auditActionLabels[item.action] ?? item.action}
            {item.id ? ` · ${item.id}` : ''}
          </strong>
          {item.changes?.map((change, index) => (
            <p key={index}>
              <b>{change.field}</b>: {logValue(change.before)} → {logValue(change.after)}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

export function AdminScreen() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [tab, setTab] = useState<Tab>('orders')
  const [error, setError] = useState('')
  function contentSaved(content: SiteContent) {
    setDashboard((current) => (current ? { ...current, content } : current))
    publishSiteUpdate('content')
  }
  async function refresh() {
    const result = await apiRequest<Dashboard>('/admin/dashboard')
    setDashboard(result)
    setError('')
    return result
  }
  useEffect(() => {
    apiRequest('/admin/session')
      .then(() => {
        setAuthenticated(true)
        return refresh().catch((failure) => setError(errorMessage(failure)))
      })
      .catch(() => undefined)
  }, [])
  async function login(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await apiRequest('/admin/login', { method: 'POST', body: JSON.stringify({ password }) })
      setPassword('')
      setAuthenticated(true)
      await refresh()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }
  async function logout() {
    try {
      await apiRequest('/admin/logout', { method: 'POST' })
      setError('')
      setAuthenticated(false)
      setDashboard(null)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }
  if (!authenticated)
    return (
      <main className={styles.login}>
        <div className={styles.loginCard}>
          <Link to="/">← На сайт</Link>
          <h1>Панель администратора</h1>
          <p>Введите пароль администратора.</p>
          <form onSubmit={(event) => void login(event)}>
            <label className={styles.field}>
              <span>Пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button type="submit">Войти</button>
          </form>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    )
  return (
    <main className={styles.root}>
      <div className={styles.top}>
        <div>
          <p className={styles.eyebrow}>УПРАВЛЕНИЕ САЙТОМ</p>
          <h1>Панель администратора</h1>
          <p>Изменения появляются на сайте сразу после сохранения.</p>
        </div>
        <div className={styles.topActions}>
          <Link to="/">Открыть сайт ↗</Link>
          <button type="button" className={styles.secondary} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </div>
      <nav className={styles.tabs} aria-label="Разделы панели">
        {(
          [
            ['orders', 'Заказы'],
            ['clients', 'Клиенты'],
            ['content', 'Сайт и баннеры'],
            ['promotions', 'Акции'],
            ['codes', 'Бонус-коды'],
            ['categories', 'Разделы меню'],
            ['products', 'Товары'],
            ['legal', 'Документы'],
            ['logs', 'Журнал'],
            ['iiko', 'iiko'],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={tab === id ? styles.active : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && dashboard && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!dashboard ? (
        <div className={styles.editor}>
          {error ? (
            <>
              <p className={styles.error} role="alert">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void refresh().catch((failure) => setError(errorMessage(failure)))}
              >
                Повторить загрузку
              </button>
            </>
          ) : (
            <p>Загрузка…</p>
          )}
        </div>
      ) : (
        <div key={tab}>
          {tab === 'orders' ? (
            <OrdersEditor />
          ) : tab === 'clients' ? (
            <ClientsEditor />
          ) : tab === 'content' ? (
            <ContentEditor initial={dashboard.content} onSaved={contentSaved} />
          ) : tab === 'promotions' ? (
            <ContentEditor
              initial={dashboard.content}
              onSaved={contentSaved}
              section="promotions"
            />
          ) : tab === 'codes' ? (
            <BonusCodesEditor />
          ) : tab === 'categories' ? (
            <CategoriesEditor data={dashboard} refresh={refresh} />
          ) : tab === 'products' ? (
            <ProductsEditor data={dashboard} refresh={refresh} />
          ) : tab === 'legal' ? (
            <LegalEditor initial={dashboard.content} onSaved={contentSaved} />
          ) : tab === 'logs' ? (
            <LogsEditor />
          ) : (
            <IikoEditor configured={dashboard.iikoConfigured} refresh={refresh} />
          )}
        </div>
      )}
    </main>
  )
}
