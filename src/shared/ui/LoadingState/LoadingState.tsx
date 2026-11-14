import { Spinner } from '../Spinner/Spinner'
import styles from './LoadingState.module.css'

export function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`${styles.loading} ${compact ? styles.compact : ''}`} role="status">
      <Spinner label={label} size={compact ? 20 : 36} decorative />
      <span>{label}</span>
    </div>
  )
}
