import { useEffect, useState } from 'react'
import styles from './ScrollTopButton.module.css'

/** Показывает кнопку «Наверх» после прокрутки больше чем на один экран. */
export function ScrollTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let ticking = false

    const update = () => {
      ticking = false
      setVisible(window.scrollY > window.innerHeight)
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <button
      type="button"
      className={`${styles.root} ${visible ? styles.visible : ''}`}
      aria-label="Наверх"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 19V5m-7 7 7-7 7 7" />
      </svg>
    </button>
  )
}
