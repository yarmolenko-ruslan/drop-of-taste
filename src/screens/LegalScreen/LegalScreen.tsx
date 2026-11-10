import { Link } from 'react-router'
import styles from './LegalScreen.module.css'
import { useSiteContent } from '../../features/site-content/SiteContentProvider'

type LegalScreenProps = {
  variant: 'privacy' | 'consent'
}

export function LegalScreen({ variant }: LegalScreenProps) {
  const content = useSiteContent()
  const page = content.legal[variant]

  return (
    <main className={styles.root}>
      <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
        <Link to="/">Главная</Link>
        <span aria-hidden="true">/</span>
        <span>{page.title}</span>
      </nav>
      <article className={styles.document}>
        <span className={styles.eyebrow}>ИНФОРМАЦИЯ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ</span>
        <h1>{page.title}</h1>
        {variant === 'consent' && <p>Редакция от {content.legalRevision}</p>}
        <p className={styles.intro}>{page.intro}</p>
        {page.sections.map(([title, text]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
        <p className={styles.related}>
          {variant === 'privacy' ? (
            <Link to="/data-consent">Согласие на обработку персональных данных</Link>
          ) : (
            <Link to="/privacy">Политика конфиденциальности</Link>
          )}
        </p>
      </article>
    </main>
  )
}
