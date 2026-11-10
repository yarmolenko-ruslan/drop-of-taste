import { useState } from 'react'
import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import { issuesByField } from '../../../../../shared/validation/issues'
import { addressDetailsSchema, formatAddress, type AddressDetails } from './address'
import styles from './FulfillmentDialog.module.css'
import { useSiteContent } from '../../../site-content/SiteContentProvider'

export type { AddressDetails }

export type FulfillmentSelection = {
  mode: 'delivery' | 'pickup'
  label: string
  details?: AddressDetails
}

type FulfillmentDialogProps = {
  current?: FulfillmentSelection
  onClose: () => void
  onSave: (selection: FulfillmentSelection) => void
}

export function FulfillmentDialog({ current, onClose, onSave }: FulfillmentDialogProps) {
  const { brandName } = useSiteContent()
  const initial = current?.mode === 'delivery' ? current.details : undefined
  const [street, setStreet] = useState(initial?.street ?? '')
  const [entrance, setEntrance] = useState(initial?.entrance ?? '')
  const [floor, setFloor] = useState(initial?.floor ?? '')
  const [flat, setFlat] = useState(initial?.flat ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [isHouse, setIsHouse] = useState(initial?.isHouse ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function clearError(field: string) {
    setErrors((currentErrors) => {
      if (!(field in currentErrors)) return currentErrors
      const next = { ...currentErrors }
      delete next[field]
      return next
    })
  }

  return (
    <Dialog titleId="fulfillment-title" onClose={onClose} className={styles.addressDialog}>
      <div className={`${styles.content} ${styles.addressContent}`}>
        <span className={styles.eyebrow}>{brandName}</span>
        <h2 id="fulfillment-title">Адрес доставки</h2>
        <p className={styles.intro}>Укажите адрес для доставки заказа.</p>

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
            onSave({ mode: 'delivery', label: formatAddress(parsed.data), details: parsed.data })
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
                placeholder="Например, ул. Мира, 17"
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

        <button className={styles.save} type="submit" form="fulfillment-form">
          Сохранить выбор
        </button>
      </div>
    </Dialog>
  )
}
