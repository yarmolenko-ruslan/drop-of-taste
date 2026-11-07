import type { ReactNode } from 'react'
import styles from './ErrorPage.module.css'

type ErrorPageProps = {
  /** Крупный код ошибки (например, «404»); опционален. */
  code?: string
  /** Текст иллюстрации для скринридеров; сама иллюстрация декоративна. */
  illustrationLabel?: string
  title: string
  message: string
  /** Кнопки-действия («На главную», «Обновить страницу» и т.п.). */
  actions?: ReactNode
}

/** Единый оформленный экран ошибок: 404, сбой загрузки чанка и др. */
export function ErrorPage({ code, illustrationLabel, title, message, actions }: ErrorPageProps) {
  return (
    <main className={styles.root}>
      <section className={styles.card} aria-labelledby="error-page-title">
        {code && <p className={styles.code}>{code}</p>}
        <svg
          className={styles.illustration}
          viewBox="0 0 220 150"
          role="img"
          aria-label={illustrationLabel ?? 'Чашка кофе с блюдцем'}
        >
          {/* пары над чашкой */}
          <path
            d="M82 34c-5-7 5-10 0-17M104 34c-5-7 5-10 0-17M126 34c-5-7 5-10 0-17"
            fill="none"
            stroke="#dfb86f"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* чашка */}
          <path d="M56 52h96v26c0 24-19 40-48 40s-48-16-48-40V52Z" fill="#a70d22" />
          <ellipse cx="104" cy="52" rx="48" ry="9" fill="#3f080e" />
          <ellipse cx="104" cy="52" rx="38" ry="6" fill="#572328" />
          {/* ручка */}
          <path
            d="M152 60c16 0 24 8 24 17s-8 17-24 17"
            fill="none"
            stroke="#a70d22"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* блюдце */}
          <ellipse cx="104" cy="126" rx="62" ry="8" fill="#dfb86f" />
          <ellipse cx="104" cy="124" rx="62" ry="8" fill="#e9c78c" />
          {/* капля */}
          <path
            d="M182 96c5 7 8 10 8 14a8 8 0 1 1-16 0c0-4 3-7 8-14Z"
            fill="#a70d22"
            opacity="0.55"
          />
        </svg>
        <h1 id="error-page-title" className={styles.title}>
          {title}
        </h1>
        <p className={styles.message}>{message}</p>
        {actions && <div className={styles.actions}>{actions}</div>}
      </section>
    </main>
  )
}
