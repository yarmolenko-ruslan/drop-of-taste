import { Link } from 'react-router'
import styles from './AboutScreen.module.css'
import { useSiteContent } from '../../features/site-content/SiteContentProvider'

export function AboutScreen() {
  const content = useSiteContent()
  return (
    <main className={styles.root}>
      <section className={`${styles.container} ${styles.intro}`} aria-labelledby="about-title">
        <nav className={styles.breadcrumbs} aria-label="Навигационная цепочка">
          <Link to="/">Главная</Link>
          <span aria-hidden="true">/</span>
          <span>{content.aboutPageTitle}</span>
        </nav>

        <div className={styles.hero}>
          <div className={styles.copy}>
            <span className={styles.eyebrow}>{content.aboutEyebrow}</span>
            <h1 id="about-title">{content.aboutPageTitle}</h1>
            <p className={styles.lead}>{content.aboutLead}</p>
            {content.aboutParagraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          <img
            className={styles.photo}
            src={content.aboutImage}
            alt={content.aboutImageAlt}
            width="1400"
            height="788"
          />
        </div>

        <div className={styles.details}>
          <section aria-labelledby="visit-title">
            <h2 id="visit-title">{content.visitTitle}</h2>
            <address>{content.address}</address>
            <p>{content.hours}</p>
          </section>
          <section aria-labelledby="menu-title">
            <h2 id="menu-title">{content.highlightsTitle}</h2>
            <ul>
              {content.aboutHighlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </section>

      <section className={styles.mapSection} aria-labelledby="map-title">
        <div className={`${styles.container} ${styles.mapHeading}`}>
          <div>
            <span className={styles.eyebrow}>МЫ НА КАРТЕ</span>
            <h2 id="map-title">{content.mapTitle}</h2>
          </div>
          <address>{content.address}</address>
        </div>
        <iframe
          className={styles.map}
          src={content.mapEmbedUrl}
          title={`Кафе «${content.siteTitle}» на Яндекс Карте: ${content.address}`}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      </section>
    </main>
  )
}
