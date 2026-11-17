/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { defaultSiteContent, type SiteContent } from '../../../shared/site-content'
import { apiRequest } from '../auth/api/authApi'
import { subscribeSiteUpdate } from '../../shared/lib/siteUpdates'
import { mergeSiteSettings } from '../../../shared/site-settings'

const Context = createContext<SiteContent>(defaultSiteContent)

export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<SiteContent>(defaultSiteContent)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let requestId = 0
    async function refresh() {
      const currentRequest = ++requestId
      if (timer) clearTimeout(timer)
      let nextDelay = 60_000
      try {
        const data = await apiRequest<SiteContent & { nextPromotionChangeInMs?: number }>(
          '/site-content',
        )
        if (!active || currentRequest !== requestId) return
        if (data && typeof data.browserTitle === 'string')
          setContent({ ...data, settings: mergeSiteSettings(data.settings) })
        if (data && data.nextPromotionChangeInMs !== undefined)
          nextDelay = Math.min(nextDelay, Math.max(100, data.nextPromotionChangeInMs + 100))
      } catch {
        /* Повторяем запрос после паузы. */
      }
      if (active && currentRequest === requestId)
        timer = setTimeout(() => void refresh(), nextDelay)
    }
    void refresh()
    const unsubscribe = subscribeSiteUpdate('content', () => void refresh())
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    document.title = content.browserTitle
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.href = content.settings.favicon || content.brandLogo
      icon.removeAttribute('type')
    }
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!description) {
      description = document.createElement('meta')
      description.name = 'description'
      document.head.append(description)
    }
    description.content = content.settings.seoDescription
    const colors = content.settings.appearance
    const values = {
      '--color-brand-red': colors.brand,
      '--color-accent': colors.brand,
      '--color-bg': colors.background,
      '--color-text': colors.text,
      '--color-gold': colors.gold,
      '--color-burgundy': colors.burgundy,
      '--color-gold-light': colors.goldLight,
    }
    for (const [key, value] of Object.entries(values))
      document.documentElement.style.setProperty(key, value)
    return () => {
      for (const key of Object.keys(values)) document.documentElement.style.removeProperty(key)
    }
  }, [content.browserTitle, content.brandLogo, content.settings])
  return <Context.Provider value={content}>{children}</Context.Provider>
}

export function useSiteContent() {
  return useContext(Context)
}
