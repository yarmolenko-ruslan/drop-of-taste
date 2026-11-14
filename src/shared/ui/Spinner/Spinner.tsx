import styles from './Spinner.module.css'

type SpinnerProps = {
  /** Доступное имя для скринридеров; статус объявляется через role="status". */
  label: string
  size?: number
  decorative?: boolean
}

export function Spinner({ label, size = 44, decorative = false }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative || undefined}
    >
      <span className={styles.ring} style={{ width: size, height: size }} aria-hidden="true" />
      {!decorative && <span className={styles.visuallyHidden}>{label}</span>}
    </span>
  )
}
