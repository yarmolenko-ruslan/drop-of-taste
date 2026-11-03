import { useEffect, useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { formatAddress, type AddressDetails } from './address'
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
  const debouncedStreet = useDebouncedValue(street)
  const deliveryMapUrl = debouncedStreet.trim()
    ? `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(`Красноярск, ${debouncedStreet.trim()}`)}&z=16`
    : cityMapUrl

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
                const details: AddressDetails = {
                  street: street.trim(),
                  entrance,
                  floor,
                  flat,
                  comment,
                  isHouse,
                }
                if (details.street) onSave({ mode, label: formatAddress(details), details })
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
              <label className={styles.house}>
                <input
                  type="checkbox"
                  checked={isHouse}
                  onChange={(event) => setIsHouse(event.target.checked)}
                />
                Частный дом
              </label>
              <div className={styles.fields}>
                <label className={isHouse ? styles.optional : undefined}>
                  Подъезд
                  <input
                    inputMode="numeric"
                    placeholder="—"
                    value={entrance}
                    onChange={(event) => setEntrance(event.target.value)}
                    required={!isHouse}
                    disabled={isHouse}
                  />
                </label>
                <label className={isHouse ? styles.optional : undefined}>
                  Этаж
                  <input
                    inputMode="numeric"
                    placeholder="—"
                    value={floor}
                    onChange={(event) => setFloor(event.target.value)}
                    required={!isHouse}
                    disabled={isHouse}
                  />
                </label>
                <label className={isHouse ? styles.optional : undefined}>
                  Квартира
                  <input
                    placeholder="—"
                    value={flat}
                    onChange={(event) => setFlat(event.target.value)}
                    required={!isHouse}
                    disabled={isHouse}
                  />
                </label>
              </div>
              <label className={styles.full}>
                Комментарий к адресу
                <textarea
                  placeholder="Домофон, ориентир или пожелания курьеру"
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
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
            {mode === 'delivery' ? 'Сохранить выбор' : 'Кафе на карте'}
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
