import { useState } from 'react'
import styles from './CatalogActionButton.module.css'

type CatalogActionButtonProps = {
  onClick?: () => void
}

export function CatalogActionButton({ onClick }: CatalogActionButtonProps) {
  const [isActive, setIsActive] = useState(false)

  return (
    <button
      className={styles.action}
      type="button"
      onMouseEnter={() => setIsActive(true)}
      onMouseLeave={() => setIsActive(false)}
      onFocus={() => setIsActive(true)}
      onBlur={() => setIsActive(false)}
      onClick={onClick}
    >
      {isActive ? 'Выбрать' : 'В корзину'}
    </button>
  )
}
