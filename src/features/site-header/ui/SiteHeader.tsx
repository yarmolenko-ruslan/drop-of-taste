import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { cartCount, useCartStore } from '../../cart'
import { MobileMenu } from './MobileMenu'
import { categories } from './navigation'
import { useCatalog } from '../../catalog/api/CatalogProvider'
import { useSiteContent } from '../../site-content/SiteContentProvider'
import { formatRussianPhone } from '../../../../shared/validation/phone'
import styles from './SiteHeader.module.css'

type SiteHeaderProps = {
  phoneNumber?: string
  addressLabel?: string
  accountLabel?: string
  onAddressClick?: () => void
  onAccountClick?: () => void
}

export function SiteHeader({
  phoneNumber,
  addressLabel,
  accountLabel,
  onAddressClick,
  onAccountClick,
}: SiteHeaderProps) {
  const content = useSiteContent()
  const catalog = useCatalog()?.data
  const orderedCategories = catalog
    ? [
        ...catalog.categories.filter(
          (category) => category.id === 'combo' && category.products.length > 0,
        ),
        ...catalog.categories.filter((category) => !['combo', 'sauces'].includes(category.id)),
        ...catalog.categories.filter((category) => category.id === 'sauces'),
      ]
    : null
  const liveCategories: readonly (readonly [string, string])[] = catalog
    ? [
        ['Акции', 'promotions'],
        ...(catalog.newArrivalIds.length > 0 ? [['Новинки', 'new'] as const] : []),
        ...orderedCategories!.map((category) => [category.title, category.id] as const),
      ]
    : categories
  const dialNumber = phoneNumber?.replace(/[^+\d]/g, '')
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const isHome = pathname === '/'
  const showCategories = pathname !== '/about'
  const count = useCartStore((state) => cartCount(state.lines))
  const openCart = useCartStore((state) => state.open)
  const headerRef = useRef<HTMLElement>(null)
  const [compactVisible, setCompactVisible] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const categoryAnchors = liveCategories
    .map(([, anchor]) => anchor)
    .filter((anchor) => anchor !== 'promotions')
    .join('|')

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1050px)')
    const closeOnWideScreen = () => {
      if (!media.matches) setMenuOpen(false)
    }
    media.addEventListener('change', closeOnWideScreen)
    return () => media.removeEventListener('change', closeOnWideScreen)
  }, [])

  useEffect(() => {
    if (!isHome) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = Math.min(220, Math.max(96, window.innerHeight * 0.28))
      let current: string | null = null
      let closestTop = -Infinity
      for (const anchor of categoryAnchors.split('|')) {
        const top = document.getElementById(anchor)?.getBoundingClientRect().top
        if (top !== undefined && top <= line && top > closestTop) {
          current = anchor
          closestTop = top
        }
      }
      setActiveCategory(current)
    }
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()
    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      cancelAnimationFrame(frame)
    }
  }, [isHome, categoryAnchors])

  const renderCategoryLink = ([label, anchor]: readonly [string, string]) => {
    const active =
      anchor === 'promotions'
        ? pathname.startsWith('/promotions')
        : isHome && activeCategory === anchor
    const className = `${styles.category} ${anchor === 'promotions' ? styles.promotion : ''} ${active ? styles.current : ''}`
    if (anchor === 'promotions')
      return (
        <Link
          className={className}
          to="/promotions"
          key={anchor}
          aria-current={active ? 'page' : undefined}
        >
          {label}
        </Link>
      )
    return (
      <a
        className={className}
        href={`${isHome ? '' : '/'}#${anchor}`}
        key={anchor}
        aria-current={isHome && active ? 'location' : undefined}
      >
        {label}
      </a>
    )
  }

  useEffect(() => {
    let ticking = false

    const update = () => {
      ticking = false
      const threshold = headerRef.current?.offsetHeight ?? 0
      setCompactVisible(window.scrollY > threshold)
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
    <>
      <header className={styles.header} ref={headerRef}>
        <div className={styles.mainBar}>
          <div className={`${styles.container} ${styles.mainContent}`}>
            <button
              className={styles.burger}
              type="button"
              aria-label="Открыть меню"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <Link className={styles.brand} to="/" aria-label={`${content.siteTitle} — главная`}>
              <img src={content.brandLogo} alt="" width="64" height="64" />
              <span className={styles.brandText}>
                <span className={styles.brandName}>{content.brandName}</span>
                <span className={styles.brandTagline}>
                  <span className={styles.taglineRule} aria-hidden="true" />
                  <span>{content.tagline}</span>
                  <span className={styles.taglineDot} aria-hidden="true" />
                  <span>КАФЕ</span>
                  <span className={styles.taglineRule} aria-hidden="true" />
                </span>
              </span>
            </Link>

            <button
              className={styles.address}
              type="button"
              aria-label="Кафе на карте"
              onClick={onAddressClick}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              <span>
                <strong>{addressLabel ?? 'Адрес кафе'}</strong>
              </span>
            </button>

            <form
              className={styles.search}
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                const query = new FormData(event.currentTarget).get('q')?.toString().trim()
                if (query) navigate(`/search?${new URLSearchParams({ q: query })}`)
              }}
            >
              <button className={styles.searchSubmit} type="submit" aria-label="Найти блюда">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="6.4" />
                  <path d="m16 16 5 5" />
                </svg>
              </button>
              <input
                key={pathname === '/search' ? search : pathname}
                type="search"
                name="q"
                aria-label="Искать блюда"
                placeholder="Искать блюда"
                defaultValue={
                  pathname === '/search' ? (new URLSearchParams(search).get('q') ?? '') : ''
                }
              />
            </form>

            <div className={styles.phoneBlock}>
              {dialNumber ? (
                <a className={styles.phone} href={`tel:${dialNumber}`}>
                  {formatRussianPhone(phoneNumber ?? '')}
                </a>
              ) : null}
              <span className={styles.hours}>{content.hours}</span>
            </div>

            <button
              className={styles.login}
              type="button"
              aria-label={accountLabel ?? 'Войти'}
              onClick={onAccountClick}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
              </svg>
            </button>
            <button
              className={styles.cart}
              type="button"
              aria-label={`Корзина, ${count} поз.`}
              onClick={openCart}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 8h16l-1.5 12h-13L4 8ZM9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              <span className={styles.cartCount}>
                <span
                  className={`${styles.cartCountValue} ${count === 1 ? styles.cartCountOne : ''}`}
                >
                  {count}
                </span>
              </span>
            </button>
          </div>
        </div>

        {showCategories && (
          <nav className={styles.categoryBar} aria-label="Категории меню">
            <div className={`${styles.container} ${styles.categoryList}`}>
              {liveCategories.map(renderCategoryLink)}
            </div>
          </nav>
        )}
      </header>

      <div
        className={`${styles.compactBar} ${compactVisible ? styles.compactVisible : ''}`}
        aria-hidden={!compactVisible}
        role="region"
        aria-label="Быстрая навигация"
      >
        <div className={`${styles.container} ${styles.compactContent}`}>
          <button
            className={styles.compactMenu}
            type="button"
            aria-label="Открыть меню"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <span className={styles.compactMenuLines} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Меню
          </button>

          <Link
            className={styles.compactBrand}
            to="/"
            aria-label={`${content.siteTitle} — главная`}
          >
            <img src={content.brandLogo} alt="" width="40" height="40" />
          </Link>

          {showCategories && (
            <nav className={styles.compactNav} aria-label="Категории меню">
              <div className={styles.compactCategories}>
                {liveCategories.map(renderCategoryLink)}
              </div>
            </nav>
          )}

          <div className={styles.compactActions}>
            <button
              className={styles.login}
              type="button"
              aria-label={accountLabel ?? 'Войти'}
              onClick={onAccountClick}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
              </svg>
            </button>
            <button
              className={styles.cart}
              type="button"
              aria-label={`Корзина, ${count} поз.`}
              onClick={openCart}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 8h16l-1.5 12h-13L4 8ZM9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              <span className={styles.cartCount}>
                <span
                  className={`${styles.cartCountValue} ${count === 1 ? styles.cartCountOne : ''}`}
                >
                  {count}
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
      {menuOpen && (
        <MobileMenu
          phoneNumber={phoneNumber}
          categories={liveCategories}
          address={content.address}
          hours={content.hours}
          brandName={content.brandName}
          brandLogo={content.brandLogo}
          onAddressClick={onAddressClick}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  )
}
