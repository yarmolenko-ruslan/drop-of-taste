import { defaultSiteContent, type SiteContent } from '../../../shared/site-content.ts'
import { can, contentPermissionGroup, type AdminPrincipal } from '../../../shared/admin-access.ts'

/** Do not return fields belonging to sections this employee cannot read. */
export function adminContent(
  content: SiteContent,
  principal: AdminPrincipal | null,
): Partial<SiteContent> {
  if (principal?.role === 'owner') return content
  return Object.fromEntries(
    Object.entries(content).filter(
      ([key]) =>
        Object.hasOwn(defaultSiteContent, key) &&
        can(principal, `${contentPermissionGroup(key)}.read`),
    ),
  )
}

export const clientProjection = {
  _id: 1,
  name: 1,
  phone: 1,
  email: 1,
  birthday: 1,
  consentAcceptedAt: 1,
} as const
export const orderContactProjection = { _id: 1, name: 1, phone: 1 } as const
/** Deliberate inclusion list: payment attempts/URLs and future internal fields stay on the server. */
export const employeeOrderProjection = {
  _id: 1,
  accountId: 1,
  createdAt: 1,
  completedAt: 1,
  canceledAt: 1,
  fulfilledAt: 1,
  status: 1,
  fulfillmentStatus: 1,
  'payment.status': 1,
  'input.fulfillment.mode': 1,
  'input.fulfillment.label': 1,
  'input.fulfillment.details.street': 1,
  'input.fulfillment.details.entrance': 1,
  'input.fulfillment.details.floor': 1,
  'input.fulfillment.details.flat': 1,
  'input.fulfillment.details.comment': 1,
  'input.fulfillment.details.isHouse': 1,
  'quote.lines.productId': 1,
  'quote.lines.name': 1,
  'quote.lines.quantity': 1,
  'quote.lines.unitPriceKopecks': 1,
  'quote.lines.lineTotalKopecks': 1,
  'quote.subtotalKopecks': 1,
  'quote.totalKopecks': 1,
  'quote.discountKopecks': 1,
  'quote.promoCode': 1,
  'quote.promoDiscountKopecks': 1,
  'quote.birthdayDiscountKopecks': 1,
  'quote.deliveryKopecks': 1,
  'quote.adjustments.label': 1,
  'quote.adjustments.amountKopecks': 1,
} as const
