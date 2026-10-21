/** Service request detail as returned by GET /service-requests/:id (owner and admin views). */
export interface RequestDetail {
  id: string;
  reference: string;
  title: string;
  status: string;
  urgency: string;
  safetyFlag: boolean;
  description: string;
  intakeAnswers: Record<string, unknown>;
  intakeSchema: { fields: Array<{ key: string; label: string; options?: Array<{ value: string; label: string }> }> };
  preferredWindows: Array<{ start: string; end: string }>;
  safetyGuidance: Array<{ key: string; text: string | null }>;
  category: string | null;
  categoryId: string;
  categorySlug: string;
  createdOnBehalfBy?: string | null;
  property: { id: string; nickname: string; city: string; locality: string; pinCode: string; serviceMode: string };
  accessContact: { id: string; name: string; relationship: string; phone?: string } | null;
  timeline: Array<{ from: string | null; to: string; actorRole: string; reason?: string | null; at: string }>;
  inspections: Array<{ id: string; status: string; scheduledStart: string; scheduledEnd: string; feePaise: number; findings: string | null; providerName?: string | null }>;
  attachments: Array<{ id: string; filename: string }>;
  paymentRequirements: Array<{ id: string; purpose: string; amountPaise: number; status: string; isDue: boolean; paidPaise: number; workOrderId: string | null }>;
  workOrders: Array<{ id: string; reference: string; kind: string; status: string; scheduledStart: string | null; scheduledEnd: string | null }>;
  submittedAt: string;
  handledByAdminId?: string | null;
  ownerUserId?: string;
}

export function answerLabel(r: RequestDetail, key: string, value: unknown): string {
  const field = r.intakeSchema.fields.find((f) => f.key === key);
  const opt = (v: unknown) => field?.options?.find((o) => o.value === v)?.label ?? String(v);
  if (Array.isArray(value)) return value.map(opt).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return opt(value);
}
