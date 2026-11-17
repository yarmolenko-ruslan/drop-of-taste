import { useEffect, useRef, useState } from 'react'
import { LoadingState } from '../LoadingState/LoadingState'
import styles from './MapFrame.module.css'

type MapFrameProps = {
  src: string
  backupSrc?: string
  title: string
  routeUrl: string
  className?: string
}

type Source = 'primary' | 'backup' | 'error'
const LOAD_TIMEOUT_MS = 12000

export function MapFrame({ src, backupSrc, title, routeUrl, className }: MapFrameProps) {
  return (
    <MapFrameContent
      key={JSON.stringify([src, backupSrc])}
      src={src}
      backupSrc={backupSrc}
      title={title}
      routeUrl={routeUrl}
      className={className}
    />
  )
}

function MapFrameContent({ src, backupSrc, title, routeUrl, className }: MapFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<Source>('primary')
  const [started, setStarted] = useState(() => typeof IntersectionObserver === 'undefined')
  const [source, setSource] = useState<Source>('primary')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (started) return
    const node = frameRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setStarted(true)
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [started])

  const switchSource = (next: Source) => {
    sourceRef.current = next
    setSource(next)
    setLoaded(false)
  }

  useEffect(() => {
    if (!started || loaded || source === 'error') return
    const timeout = window.setTimeout(() => {
      if (sourceRef.current === source)
        switchSource(source === 'primary' && backupSrc ? 'backup' : 'error')
    }, LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [started, loaded, source, backupSrc])

  const fail = () => {
    if (sourceRef.current !== source) return
    switchSource(source === 'primary' && backupSrc ? 'backup' : 'error')
  }

  return (
    <div ref={frameRef} className={`${styles.frame} ${className ?? ''}`}>
      {started && source !== 'error' && (
        <iframe
          key={source}
          className={styles.map}
          src={source === 'primary' ? src : backupSrc}
          title={title}
          loading="eager"
          allowFullScreen
          referrerPolicy="no-referrer"
          onLoad={() => {
            if (sourceRef.current === source) setLoaded(true)
          }}
          onError={fail}
        />
      )}
      {source === 'error' ? (
        <div className={styles.overlay} role="alert">
          <p>Не удалось загрузить карту. Адрес кафе указан рядом.</p>
          <button type="button" onClick={() => switchSource('primary')}>
            Попробовать ещё раз
          </button>
          <a href={routeUrl} target="_blank" rel="noopener noreferrer">
            Открыть маршрут отдельно
          </a>
        </div>
      ) : loaded ? (
        <button className={styles.help} type="button" onClick={fail}>
          Карта не отображается?
        </button>
      ) : (
        <div className={styles.overlay}>
          <LoadingState
            label={source === 'primary' ? 'Загружаем карту…' : 'Загружаем резервную карту…'}
          />
        </div>
      )}
    </div>
  )
}
