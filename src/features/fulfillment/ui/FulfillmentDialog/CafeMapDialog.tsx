import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import styles from './FulfillmentDialog.module.css'

const cafeAddress = 'г. Красноярск, улица Петра Подзолкова, 3и'
const mapUrl =
  'https://yandex.ru/map-widget/v1/?ll=92.884165%2C56.049189&mode=search&oid=172905214895&ol=biz&z=16.73'
const routeUrl = 'https://yandex.ru/maps/?rtext=~56.049189,92.884165'

export function CafeMapDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog titleId="cafe-map-title" onClose={onClose} className={styles.dialog}>
      <div className={styles.layout}>
        <div className={styles.content}>
          <span className={styles.eyebrow}>КАПЕЛА ВКУСА</span>
          <h2 id="cafe-map-title">Самовывоз из кафе</h2>
          <p className={styles.intro}>
            Оформите заказ на сайте и заберите его в нашем кафе со скидкой 10%.
          </p>
          <div className={styles.pickup}>
            <span className={styles.pickupLabel}>АДРЕС КАФЕ</span>
            <address>{cafeAddress}</address>
            <p>Ежедневно с 08:00 до 20:00</p>
          </div>
          <button
            className={styles.save}
            type="button"
            onClick={() => window.open(routeUrl, '_blank', 'noopener,noreferrer')}
          >
            Маршрут до кафе
          </button>
        </div>
        <iframe
          className={styles.map}
          src={mapUrl}
          title={`Кафе «Капела вкуса» на Яндекс Карте: ${cafeAddress}`}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      </div>
    </Dialog>
  )
}
