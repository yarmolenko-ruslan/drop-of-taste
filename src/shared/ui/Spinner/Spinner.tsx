import styles from './Spinner.module.css'

type SpinnerProps = {
  /** Доступное имя для скринридеров; статус объявляется через role="status". */
  label: string
  size?: number
}

export function Spinner({ label, size = 44 }: SpinnerProps) {
  return (
    <span className={styles.spinner} role="status">
      <span className={styles.ring} style={{ width: size, height: size }} aria-hidden="true" />
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  )
}
