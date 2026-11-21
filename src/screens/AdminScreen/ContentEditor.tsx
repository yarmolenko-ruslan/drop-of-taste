import { Select } from '../../shared/ui/Select/Select'
import { useState, type FormEvent } from 'react'
import { apiRequest } from '../../features/auth/api/authApi'
import styles from './AdminScreen.module.css'
import type { SiteContent } from '../../../shared/site-content'
import {
  completeAdminContent,
  changedContentFields,
  errorMessage,
  localDate,
  isoDate,
} from './adminUtils'
import { TextField, ImageField, PhoneField } from './AdminFields'
import { SiteSettingsEditor } from './SiteSettingsEditor'
import { defaultSiteContent } from '../../../shared/site-content'

function BannerDestinationField({
  value,
  promotions,
  onChange,
}: {
  value: string
  promotions: SiteContent['promotions']
  onChange: (value: string) => void
}) {
  const known =
    value === '/promotions' ||
    value === '/about' ||
    promotions.some((promotion) => value === `/promotions/${promotion.id}`)
  const [editingCustom, setEditingCustom] = useState(!known)
  const custom = editingCustom || !known
  return (
    <div>
      <label className={styles.field}>
        <span>Куда ведёт картинка (ссылка внутри сайта)</span>
        <Select
          value={custom ? 'custom' : value}
          onValueChange={(next) => {
            setEditingCustom(next === 'custom')
            onChange(next === 'custom' ? '' : next)
          }}
        >
          <option value="/promotions">Все акции</option>
          <option value="/about">О кафе</option>
          {promotions.map((promotion) => (
            <option key={promotion.id} value={`/promotions/${promotion.id}`}>
              {promotion.subtitle}
            </option>
          ))}
          <option value="custom">Другая ссылка…</option>
        </Select>
      </label>
      {custom && (
        <TextField
          label="Своя ссылка внутри сайта"
          value={value}
          onChange={(next) => {
            setEditingCustom(true)
            onChange(next)
          }}
        />
      )}
    </div>
  )
}

export function ContentEditor({
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
      const result = await apiRequest<{ content: Partial<SiteContent> }>('/admin/content', {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      const updated = completeAdminContent(result.content, saved)
      setSaved(updated)
      setContent((current) => ({
        ...updated,
        ...changedContentFields(current, content, () => true),
      }))
      setMessage('Сохранено. Изменения уже видны на сайте.')
      onSaved(updated)
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
          <SiteSettingsEditor
            value={content.settings}
            onChange={(settings) => set('settings', settings)}
          />
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
              label="Резервная карта (ссылка для встраивания)"
              value={content.mapBackupEmbedUrl}
              onChange={(v) => set('mapBackupEmbedUrl', v)}
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
            <div className={styles.grid} key={index}>
              <label className={styles.field}>
                <span>Значок {index + 1}</span>
                <Select
                  value={benefit.icon}
                  onValueChange={(value) =>
                    set(
                      'benefits',
                      content.benefits.map((old, i) =>
                        i === index ? { ...old, icon: value as typeof old.icon } : old,
                      ),
                    )
                  }
                >
                  <option value="clock">Часы</option>
                  <option value="truck">Доставка</option>
                  <option value="card">Карта</option>
                  <option value="pin">Адрес</option>
                </Select>
              </label>
              <label className={styles.field}>
                <span>Источник текста {index + 1}</span>
                <Select
                  value={benefit.mode ?? 'custom'}
                  onValueChange={(value) =>
                    set(
                      'benefits',
                      content.benefits.map((old, i) =>
                        i === index ? { ...old, mode: value as NonNullable<typeof old.mode> } : old,
                      ),
                    )
                  }
                >
                  <option value="custom">Мой текст</option>
                  <option value="delivery">Актуальная стоимость доставки</option>
                  <option value="pickup">Актуальная скидка самовывоза</option>
                  <option value="payment">Доступный способ оплаты</option>
                </Select>
                <small>Чтобы вывести свой заголовок и пояснение, выберите «Мой текст».</small>
              </label>
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
            <div className={styles.panel} key={slide.id}>
              <div className={styles.row}>
                <h3>Баннер {index + 1}</h3>
                <button
                  type="button"
                  className={styles.danger}
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
              <div className={styles.row}>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => {
                    const slides = [...content.heroSlides]
                    ;[slides[index - 1], slides[index]] = [slides[index]!, slides[index - 1]!]
                    set('heroSlides', slides)
                  }}
                >
                  Выше
                </button>
                <button
                  type="button"
                  disabled={index === content.heroSlides.length - 1}
                  onClick={() => {
                    const slides = [...content.heroSlides]
                    ;[slides[index + 1], slides[index]] = [slides[index]!, slides[index + 1]!]
                    set('heroSlides', slides)
                  }}
                >
                  Ниже
                </button>
              </div>
              <TextField
                label="Название баннера"
                value={slide.title}
                onChange={(title) =>
                  set(
                    'heroSlides',
                    content.heroSlides.map((old, i) => (i === index ? { ...old, title } : old)),
                  )
                }
              />
              <TextField
                label="Метка баннера"
                value={slide.badge}
                onChange={(badge) =>
                  set(
                    'heroSlides',
                    content.heroSlides.map((old, i) => (i === index ? { ...old, badge } : old)),
                  )
                }
              />
              <TextField
                label="Описание баннера"
                value={slide.description}
                onChange={(description) =>
                  set(
                    'heroSlides',
                    content.heroSlides.map((old, i) =>
                      i === index ? { ...old, description } : old,
                    ),
                  )
                }
                multiline
              />
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={slide.showText === true}
                  onChange={(event) =>
                    set(
                      'heroSlides',
                      content.heroSlides.map((old, i) =>
                        i === index ? { ...old, showText: event.target.checked } : old,
                      ),
                    )
                  }
                />
                Показывать текст поверх изображения
              </label>
              <small>
                Для готовой картинки с уже нанесённым текстом выключите наложение. Текст внутри
                такого изображения меняется загрузкой новой картинки.
              </small>
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
              <BannerDestinationField
                value={
                  slide.href ??
                  (content.promotions.some((promotion) => promotion.id === slide.id)
                    ? `/promotions/${slide.id}`
                    : '/promotions')
                }
                promotions={content.promotions}
                onChange={(value) =>
                  set(
                    'heroSlides',
                    content.heroSlides.map((item, i) =>
                      i === index ? { ...item, href: value } : item,
                    ),
                  )
                }
              />
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
                  title: 'Новый баннер',
                  showText: true,
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
            показывают условия. Скидка ко дню рождения и скидка за самовывоз рассчитываются сервером
            при оформлении заказа.
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
                  <Select
                    value={promotion.category}
                    onValueChange={(value) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) =>
                          i === index ? { ...old, category: value as typeof old.category } : old,
                        ),
                      )
                    }
                  >
                    <option value="delivery">Доставка</option>
                    <option value="pickup">Самовывоз</option>
                    <option value="cafe">В кафе</option>
                  </Select>
                </label>
                <label className={styles.field}>
                  <span>Цвет</span>
                  <Select
                    value={promotion.theme}
                    onValueChange={(value) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) =>
                          i === index ? { ...old, theme: value as typeof old.theme } : old,
                        ),
                      )
                    }
                  >
                    {['red', 'cream', 'burgundy', 'gold', 'green', 'white'].map((color) => (
                      <option value={color} key={color}>
                        {color}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              {
                <label className={styles.field}>
                  <span>
                    <input
                      type="checkbox"
                      checked={promotion.enabled !== false}
                      onChange={(event) =>
                        set(
                          'promotions',
                          content.promotions.map((old, i) =>
                            i === index ? { ...old, enabled: event.target.checked } : old,
                          ),
                        )
                      }
                    />{' '}
                    Акция включена
                  </span>
                </label>
              }
              {promotion.id === 'birthday' && (
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={promotion.syncDiscountText !== false}
                    onChange={(event) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) =>
                          i === index ? { ...old, syncDiscountText: event.target.checked } : old,
                        ),
                      )
                    }
                  />
                  Автоматически обновлять процент в стандартных заголовках
                </label>
              )}
              {(promotion.category === 'pickup' || promotion.id === 'birthday') && (
                <label className={styles.field}>
                  <span>
                    {promotion.id === 'birthday'
                      ? 'Скидка ко дню рождения, %'
                      : 'Скидка на блюда при самовывозе, %'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={
                      promotion.discountPercent ??
                      (promotion.id === 'pickup' || promotion.id === 'birthday' ? 10 : 0)
                    }
                    onChange={(event) =>
                      set(
                        'promotions',
                        content.promotions.map((old, i) => {
                          if (i !== index) return old
                          const discountPercent = Number(event.target.value)
                          return {
                            ...old,
                            discountPercent,
                            title:
                              old.syncDiscountText !== false &&
                              /^−\d+(?:[.,]\d+)?%$/.test(old.title)
                                ? `−${discountPercent}%`
                                : old.title,
                            subtitle:
                              old.syncDiscountText !== false &&
                              /^Скидка \d+(?:[.,]\d+)?% в день рождения$/.test(old.subtitle)
                                ? `Скидка ${discountPercent}% в день рождения`
                                : old.subtitle,
                          }
                        }),
                      )
                    }
                  />
                  {promotion.id === 'pickup' && (
                    <small>
                      Комбо и наборы не участвуют. Если действует несколько акций самовывоза,
                      применяется наибольшая скидка. Проверьте текст условий после изменения
                      процента.
                    </small>
                  )}
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
          {(['birthday', 'pickup'] as const)
            .filter((id) => !content.promotions.some((item) => item.id === id))
            .map((id) => (
              <button
                type="button"
                key={id}
                className={styles.secondary}
                onClick={() =>
                  set('promotions', [
                    ...content.promotions,
                    { ...defaultSiteContent.promotions.find((item) => item.id === id)! },
                  ])
                }
              >
                Восстановить {id === 'birthday' ? 'скидку ко дню рождения' : 'скидку самовывоза'}
              </button>
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
