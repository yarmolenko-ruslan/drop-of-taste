import { z } from 'zod'
import { siteLabelNames, homeSectionNames, type SiteSettings } from '../site-settings.ts'
import { isInternalPath, isHttpsUrl } from './urls.ts'

const labelKeys = Object.keys(siteLabelNames) as [
  keyof typeof siteLabelNames,
  ...(keyof typeof siteLabelNames)[],
]
const sectionKeys = Object.keys(homeSectionNames) as [
  keyof typeof homeSectionNames,
  ...(keyof typeof homeSectionNames)[],
]
const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const money = z.number().int().min(0).max(100_000_000)
export const siteSettingsSchema: z.ZodType<SiteSettings> = z
  .object({
    delivery: z
      .object({
        minimumSubtotalKopecks: money,
        freeFromKopecks: money.nullable(),
        feeKopecks: money,
      })
      .strict(),
    labels: z.record(z.enum(labelKeys), z.string().trim().min(1).max(160)),
    sections: z.record(z.enum(sectionKeys), z.boolean()),
    appearance: z
      .object({
        brand: color,
        background: color,
        text: color,
        gold: color,
        burgundy: color,
        goldLight: color,
      })
      .strict(),
    seoDescription: z.string().trim().max(500),
    favicon: z
      .string()
      .max(2048)
      .refine((value) => !value || isInternalPath(value) || isHttpsUrl(value)),
  })
  .strict()
