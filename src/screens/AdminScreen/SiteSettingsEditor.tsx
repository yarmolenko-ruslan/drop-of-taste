import {
  appearanceNames,
  homeSectionNames,
  siteLabelNames,
  type SiteSettings,
} from '../../../shared/site-settings'
import { ImageField, TextField } from './AdminFields'
import styles from './AdminScreen.module.css'

export function SiteSettingsEditor({
  value,
  onChange,
}: {
  value: SiteSettings
  onChange: (value: SiteSettings) => void
}) {
  return (
    <>
      <h2>Доставка: реальные условия расчёта</h2>
      <p>
        Эти значения используются сервером в корзине. Изменение текста карточек само по себе не
        меняет тариф.
      </p>
      <div className={styles.grid}>
        {(
          [
            ['minimumSubtotalKopecks', 'Минимальный заказ для доставки, ₽'],
            ['feeKopecks', 'Стоимость доставки, ₽'],
          ] as const
        ).map(([key, label]) => (
          <label className={styles.field} key={key}>
            <span>{label}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              max="1000000"
              required
              value={value.delivery[key] / 100}
              onChange={(event) =>
                onChange({
                  ...value,
                  delivery: {
                    ...value.delivery,
                    [key]: Math.round(Number(event.target.value) * 100),
                  },
                })
              }
            />
          </label>
        ))}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={value.delivery.freeFromKopecks !== null}
            onChange={(event) =>
              onChange({
                ...value,
                delivery: {
                  ...value.delivery,
                  freeFromKopecks: event.target.checked ? 150_000 : null,
                },
              })
            }
          />
          Бесплатная доставка от суммы заказа
        </label>
        {value.delivery.freeFromKopecks !== null && (
          <label className={styles.field}>
            <span>Бесплатная доставка от, ₽</span>
            <input
              type="number"
              min="0"
              step="0.01"
              max="1000000"
              required
              value={value.delivery.freeFromKopecks / 100}
              onChange={(event) =>
                onChange({
                  ...value,
                  delivery: {
                    ...value.delivery,
                    freeFromKopecks: Math.round(Number(event.target.value) * 100),
                  },
                })
              }
            />
          </label>
        )}
      </div>
      <h2>Блоки главной страницы</h2>
      <div className={styles.checks}>
        {(Object.keys(homeSectionNames) as (keyof typeof homeSectionNames)[]).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value.sections[key]}
              onChange={(event) =>
                onChange({ ...value, sections: { ...value.sections, [key]: event.target.checked } })
              }
            />
            {homeSectionNames[key]}
          </label>
        ))}
      </div>
      <h2>Цвета сайта</h2>
      <div className={styles.grid}>
        {(Object.keys(appearanceNames) as (keyof typeof appearanceNames)[]).map((key) => (
          <div className={styles.field} key={key}>
            <label>
              <span>{appearanceNames[key]}</span>
              <input
                type="color"
                value={value.appearance[key]}
                onInput={(event) =>
                  onChange({
                    ...value,
                    appearance: { ...value.appearance, [key]: event.currentTarget.value },
                  })
                }
              />
            </label>
            <TextField
              label={`${appearanceNames[key]} (HEX)`}
              value={value.appearance[key]}
              onChange={(color) =>
                onChange({ ...value, appearance: { ...value.appearance, [key]: color } })
              }
            />
          </div>
        ))}
      </div>
      <h2>Поиск и значок вкладки</h2>
      <TextField
        label="Описание сайта для поисковых систем"
        value={value.seoDescription}
        onChange={(seoDescription) => onChange({ ...value, seoDescription })}
        multiline
      />
      <ImageField
        label="Значок вкладки (пусто — использовать логотип)"
        value={value.favicon}
        onChange={(favicon) => onChange({ ...value, favicon })}
      />
      <h2>Названия ссылок и кнопок</h2>
      <div className={styles.grid}>
        {(Object.keys(siteLabelNames) as (keyof typeof siteLabelNames)[]).map((key) => (
          <TextField
            key={key}
            label={siteLabelNames[key]}
            value={value.labels[key]}
            onChange={(text) => onChange({ ...value, labels: { ...value.labels, [key]: text } })}
          />
        ))}
      </div>
    </>
  )
}
