import { defaultSiteContent, type SiteContent } from '../../../shared/site-content'

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось сохранить изменения'

export const localDate = (iso?: string) =>
  iso
    ? new Date(iso)
        .toLocaleString('sv-SE', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        .replace(' ', 'T')
    : ''
export const isoDate = (value: string) =>
  value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined

export function changedContentFields(
  current: SiteContent,
  initial: SiteContent,
  include: (key: keyof SiteContent) => boolean,
): Partial<SiteContent> {
  const changed: Partial<SiteContent> = {}
  for (const key of Object.keys(current) as (keyof SiteContent)[]) {
    if (include(key) && JSON.stringify(current[key]) !== JSON.stringify(initial[key]))
      Object.assign(changed, { [key]: current[key] })
  }
  return changed
}

/** Fill UI-only defaults for omitted, inaccessible sections; never send those sections back. */
export function completeAdminContent(
  content: Partial<SiteContent>,
  baseline: SiteContent = defaultSiteContent,
): SiteContent {
  return { ...baseline, ...content }
}
