import { useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import styles from './FulfillmentDialog.module.css'

export type FulfillmentSelection = {
  mode: 'delivery' | 'pickup'
  label: string
}

type FulfillmentDialogProps = {
  current?: FulfillmentSelection
  onClose: () => void
  onSave: (selection: FulfillmentSelection) => void
}

const cafes = ['Кафе № 1', 'Кафе № 2', 'Кафе № 3'] as const

export function FulfillmentDialog({ current, onClose, onSave }: FulfillmentDialogProps) {
  const [mode, setMode] = useState<'delivery' | 'pickup'>(current?.mode ?? 'delivery')
  const [street, setStreet] = useState(current?.mode === 'delivery' ? current.label : '')
  const [cafe, setCafe] = useState(current?.mode === 'pickup' ? current.label : cafes[0])

  return (
    <Dialog titleId="fulfillment-title" onClose={onClose} className={styles.dialog}>
      <div className={styles.layout}>
        <div className={styles.content}>
          <span className={styles.eyebrow}>КАК ВАМ УДОБНО</span>
          <h2 id="fulfillment-title">Адрес доставки</h2>
          <p className={styles.intro}>Выберите способ получения заказа.</p>

          <div className={styles.switch} role="group" aria-label="Способ получения">
            <button
              type="button"
              className={mode === 'delivery' ? styles.active : ''}
              aria-pressed={mode === 'delivery'}
              onClick={() => setMode('delivery')}
            >
              Доставка
            </button>
            <button
              type="button"
              className={mode === 'pickup' ? styles.active : ''}
              aria-pressed={mode === 'pickup'}
              onClick={() => setMode('pickup')}
            >
              Самовывоз −10%
            </button>
          </div>

          {mode === 'delivery' ? (
            <form
              className={styles.form}
              id="fulfillment-form"
              onSubmit={(event) => {
                event.preventDefault()
                if (street.trim()) onSave({ mode, label: street.trim() })
              }}
            >
              <label className={styles.full}>
                Улица и дом
                <input
                  autoComplete="street-address"
                  value={street}
                  onChange={(event) => setStreet(event.target.value)}
                  placeholder="Например, ул. Мира, 10"
                  required
                />
              </label>
              <div className={styles.fields}>
                <label>
                  Подъезд
                  <input inputMode="numeric" placeholder="—" />
                </label>
                <label>
                  Этаж
                  <input inputMode="numeric" placeholder="—" />
                </label>
                <label>
                  Квартира
                  <input placeholder="—" />
                </label>
              </div>
              <label className={styles.full}>
                Комментарий к адресу
                <textarea placeholder="Домофон, ориентир или пожелания курьеру" rows={3} />
              </label>
            </form>
          ) : (
            <div className={styles.pickup} role="radiogroup" aria-label="Кафе для самовывоза">
              <p>Выберите кафе, из которого заберёте заказ.</p>
              {cafes.map((name) => (
                <label className={cafe === name ? styles.selectedCafe : ''} key={name}>
                  <input
                    type="radio"
                    name="cafe"
                    value={name}
                    aria-label={name}
                    checked={cafe === name}
                    onChange={() => setCafe(name)}
                  />
                  <span>
                    <strong>{name}</strong>
                    <small>Адрес кафе добавим позже</small>
                  </span>
                </label>
              ))}
            </div>
          )}

          <button
            className={styles.save}
            type={mode === 'delivery' ? 'submit' : 'button'}
            form={mode === 'delivery' ? 'fulfillment-form' : undefined}
            onClick={mode === 'pickup' ? () => onSave({ mode, label: cafe }) : undefined}
          >
            Сохранить выбор
          </button>
        </div>
        <div className={styles.mapSpace} aria-hidden="true" />
      </div>
    </Dialog>
  )
}
