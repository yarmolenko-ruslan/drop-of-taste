import { Dialog } from '../../../../shared/ui/Dialog/Dialog'
import styles from './FulfillmentDialog.module.css'
import { useSiteContent } from '../../../site-content/SiteContentProvider'
import { MapFrame } from '../../../../shared/ui/MapFrame/MapFrame'

export function CafeMapDialog({ onClose }: { onClose: () => void }) {
  const content = useSiteContent()
  return (
    <Dialog titleId="cafe-map-title" onClose={onClose} className={styles.dialog}>
      <div className={`${styles.layout} ${styles.cafeLayout}`}>
        <div className={styles.content}>
          <span className={styles.eyebrow}>{content.brandName}</span>
          <h2 id="cafe-map-title">Самовывоз из кафе</h2>
          <p className={styles.intro}>
            Оформите заказ на сайте и заберите его в нашем кафе. Стоимость и доступные скидки
            указаны в корзине.
          </p>
          <div className={styles.pickup}>
            <span className={styles.pickupLabel}>АДРЕС КАФЕ</span>
            <address>{content.address}</address>
            <p>{content.hours}</p>
          </div>
          <button
            className={styles.save}
            type="button"
            onClick={() => window.open(content.mapRouteUrl, '_blank', 'noopener,noreferrer')}
          >
            Маршрут до кафе
          </button>
        </div>
        <MapFrame
          key={`${content.mapEmbedUrl}:${content.mapBackupEmbedUrl}`}
          className={styles.map}
          src={content.mapEmbedUrl}
          backupSrc={content.mapBackupEmbedUrl}
          title={`Кафе «${content.siteTitle}» на карте: ${content.address}`}
          routeUrl={content.mapRouteUrl}
        />
      </div>
    </Dialog>
  )
}
