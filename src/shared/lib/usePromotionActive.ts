import { useEffect, useReducer } from 'react'
import type { SiteContent } from '../../../shared/site-content'
import { isPromotionActive } from '../../../shared/promotion'

/** Known promotion boundaries still apply while the content API is unavailable. */
export function usePromotionActive(promotion: SiteContent['promotions'][number] | undefined) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    if (!promotion || promotion.enabled === false) return
    const now = Date.now()
    const nextChange = [promotion.startsAt, promotion.endsAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .filter((time) => Number.isFinite(time) && time > now)
      .sort((a, b) => a - b)[0]
    if (nextChange === undefined) return
    // Browser timers overflow beyond approximately 24 days; check long intervals in parts.
    const timer = window.setTimeout(refresh, Math.min(nextChange - now, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [promotion, revision])
  return Boolean(promotion && isPromotionActive(promotion))
}
