/** Admin console helpers. */
const ENTITY_HREF: Record<string, string> = {
  SERVICE_REQUEST: '/admin/requests/',
  WORK_ORDER: '/admin/work-orders/',
  LISTING: '/admin/listings/',
  BOOKING: '/admin/bookings/',
  ISSUE: '/issues/',
  PAYOUT: '/admin/payouts?focus=',
  PROPERTY: '/admin/verifications?focus=',
};
export const entityHref = (type: string, id: string) => `${ENTITY_HREF[type] ?? '/admin/audit?entityId='}${id}`;
