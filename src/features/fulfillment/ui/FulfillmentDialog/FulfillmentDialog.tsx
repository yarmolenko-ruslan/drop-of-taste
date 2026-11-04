import { useEffect, useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { issuesByField } from '../../../../../shared/validation/issues'
import { addressDetailsSchema, formatAddress, type AddressDetails } from './address'
import styles from './FulfillmentDialog.module.css'

export type { AddressDetails }

export type FulfillmentSelection = {
  mode: 'delivery' | 'pickup'
  label: string
  details?: AddressDetails
}

type FulfillmentDialogProps = {
  current?: FulfillmentSelection
  allowPickup?: boolean
  onClose: () => void
  onSave: (selection: FulfillmentSelection) => void
}

const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'
const mapUrl =
  'https://yandex.ru/map-widget/v1/?ll=92.884165%2C56.049189&mode=search&oid=172905214895&ol=biz&z=16.73'
const routeUrl = 'https://yandex.ru/maps/?rtext=~56.049189,92.884165'
const cityMapUrl = 'https://yandex.ru/map-widget/v1/?ll=92.884165%2C56.049189&z=12'

function useDebouncedValue(value: string, delay = 700) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function FulfillmentDialog({
  current,
  allowPickup = true,
  onClose,
  onSave,
}: FulfillmentDialogProps) {
  const mode = allowPickup ? 'pickup' : 'delivery'
  const initial = current?.mode === 'delivery' ? current.details : undefined
  const [street, setStreet] = useState(initial?.street ?? '')
  const [entrance, setEntrance] = useState(initial?.entrance ?? '')
  const [floor, setFloor] = useState(initial?.floor ?? '')
  const [flat, setFlat] = useState(initial?.flat ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [isHouse, setIsHouse] = useState(initial?.isHouse ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const debouncedStreet = useDebouncedValue(street)
  const deliveryMapUrl = debouncedStreet.trim()
    ? `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(`Красноярск, ${debouncedStreet.trim()}`)}&z=16`
    : cityMapUrl

  function clearError(field: string) {
    setErrors((currentErrors) => {
      if (!(field in currentErrors)) return currentErrors
      const next = { ...currentErrors }
      delete next[field]
      return next
    })
  }

  return (
    <Dialog titleId="fulfillment-title" onClose={onClose} className={styles.dialog}>
      <div className={styles.layout}>
        <div className={styles.content}>
          <span className={styles.eyebrow}>КАПЕЛА ВКУСА</span>
          <h2 id="fulfillment-title">
            {mode === 'delivery' ? 'Адрес доставки' : 'Самовывоз из кафе'}
          </h2>
          <p className={styles.intro}>
            {mode === 'delivery'
              ? 'Укажите адрес для доставки заказа.'
              : 'Оформите заказ на сайте и заберите его в нашем кафе со скидкой 10%.'}
          </p>

          {mode === 'delivery' ? (
            <form
              className={styles.form}
              id="fulfillment-form"
              onSubmit={(event) => {
                event.preventDefault()
                const parsed = addressDetailsSchema.safeParse({
                  street,
                  entrance,
                  floor,
                  flat,
                  comment,
                  isHouse,
                })
                if (!parsed.success) {
                  setErrors(issuesByField(parsed.error.issues))
                  return
                }
                setErrors({})
                onSave({ mode, label: formatAddress(parsed.data), details: parsed.data })
              }}
            >
              <div className={styles.field}>
                <label className={styles.full}>
                  Улица и дом
                  <input
                    autoComplete="street-address"
                    value={street}
                    aria-invalid={Boolean(errors.street)}
                    aria-describedby={errors.street ? 'fulfillment-street-error' : undefined}
                    onChange={(event) => {
                      setStreet(event.target.value)
                      clearError('street')
                    }}
                    placeholder="Например, ул. Мира, 10"
                  />
                </label>
                {errors.street && (
                  <p className={styles.error} id="fulfillment-street-error" role="alert">
                    {errors.street}
                  </p>
                )}
              </div>
              <label className={styles.house}>
                <input
                  type="checkbox"
                  checked={isHouse}
                  onChange={(event) => {
                    setIsHouse(event.target.checked)
                    setErrors((currentErrors) => {
                      const next = { ...currentErrors }
                      delete next.entrance
                      delete next.floor
                      delete next.flat
                      return next
                    })
                  }}
                />
                Частный дом
              </label>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label className={isHouse ? styles.optional : undefined}>
                    Подъезд
                    <input
                      inputMode="numeric"
                      placeholder="—"
                      value={entrance}
                      aria-invalid={Boolean(errors.entrance)}
                      aria-describedby={errors.entrance ? 'fulfillment-entrance-error' : undefined}
                      onChange={(event) => {
                        setEntrance(event.target.value)
                        clearError('entrance')
                      }}
                      disabled={isHouse}
                    />
                  </label>
                  {errors.entrance && (
                    <p className={styles.error} id="fulfillment-entrance-error" role="alert">
                      {errors.entrance}
                    </p>
                  )}
                </div>
                <div className={styles.field}>
                  <label className={isHouse ? styles.optional : undefined}>
                    Этаж
                    <input
                      inputMode="numeric"
                      placeholder="—"
                      value={floor}
                      aria-invalid={Boolean(errors.floor)}
                      aria-describedby={errors.floor ? 'fulfillment-floor-error' : undefined}
                      onChange={(event) => {
                        setFloor(event.target.value)
                        clearError('floor')
                      }}
                      disabled={isHouse}
                    />
                  </label>
                  {errors.floor && (
                    <p className={styles.error} id="fulfillment-floor-error" role="alert">
                      {errors.floor}
                    </p>
                  )}
                </div>
                <div className={styles.field}>
                  <label className={isHouse ? styles.optional : undefined}>
                    Квартира
                    <input
                      placeholder="—"
                      value={flat}
                      aria-invalid={Boolean(errors.flat)}
                      aria-describedby={errors.flat ? 'fulfillment-flat-error' : undefined}
                      onChange={(event) => {
                        setFlat(event.target.value)
                        clearError('flat')
                      }}
                      disabled={isHouse}
                    />
                  </label>
                  {errors.flat && (
                    <p className={styles.error} id="fulfillment-flat-error" role="alert">
                      {errors.flat}
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.full}>
                  Комментарий к адресу
                  <textarea
                    placeholder="Домофон, ориентир или пожелания курьеру"
                    rows={3}
                    value={comment}
                    aria-invalid={Boolean(errors.comment)}
                    aria-describedby={errors.comment ? 'fulfillment-comment-error' : undefined}
                    onChange={(event) => {
                      setComment(event.target.value)
                      clearError('comment')
                    }}
                  />
                </label>
                {errors.comment && (
                  <p className={styles.error} id="fulfillment-comment-error" role="alert">
                    {errors.comment}
                  </p>
                )}
              </div>
            </form>
          ) : (
            <div className={styles.pickup}>
              <span className={styles.pickupLabel}>АДРЕС КАФЕ</span>
              <address>{cafeAddress}</address>
              <p>Ежедневно с 08:00 до 20:00</p>
            </div>
          )}

          <button
            className={styles.save}
            type={mode === 'delivery' ? 'submit' : 'button'}
            form={mode === 'delivery' ? 'fulfillment-form' : undefined}
            onClick={
              mode === 'pickup' ? () => window.open(routeUrl, '_blank', 'noopener') : undefined
            }
          >
            {mode === 'delivery' ? 'Сохранить выбор' : 'Маршрут до кафе'}
          </button>
        </div>
        {mode === 'pickup' ? (
          <iframe
            className={styles.map}
            src={mapUrl}
            title={`Кафе «Капела вкуса» на Яндекс Карте: ${cafeAddress}`}
            loading="lazy"
            allowFullScreen
          />
        ) : (
          <iframe
            className={styles.map}
            src={deliveryMapUrl}
            title={`Адрес доставки на Яндекс Карте: ${debouncedStreet.trim() || 'Красноярск'}`}
            loading="lazy"
            allowFullScreen
          />
        )}
      </div>
    </Dialog>
  )
}
