/**
 * Deterministic generators for MockAiProvider. They make every AI panel usable without an API
 * key (development, CI, evals) and are intentionally simple heuristics, not a model.
 * They read only the redacted context, so they also ignore any instructions inside user text.
 */
import { addDays, maxUrgency, weekdayOf, type AiFeatureKey, type Urgency } from '@propcare/shared';
import type { MockGenerator } from '../../adapters/ai';

type Ctx = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = <T = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Ctx => (v && typeof v === 'object' ? (v as Ctx) : {});
const firstSentence = (t: string, max = 160) => (t.split(/(?<=[.!?])\s/)[0] ?? t).slice(0, max);

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'electrical-repairs': ['electric', 'wiring', 'switch', 'socket', 'power', 'spark', 'mcb', 'fan', 'light'],
  'plumbing-leak-repair': ['leak', 'pipe', 'tap', 'water', 'drain', 'toilet', 'flush', 'geyser', 'plumb'],
  'painting-wall-finishing': ['paint', 'wall', 'damp patch', 'peeling', 'putty'],
  'flooring-tiling': ['tile', 'floor', 'grout', 'marble'],
  'carpentry-doors-windows': ['door', 'window', 'lock', 'hinge', 'wardrobe', 'carpent'],
  'roof-waterproofing': ['roof', 'terrace', 'seepage', 'waterproof', 'ceiling drip'],
  'deep-cleaning': ['clean', 'dust', 'mould', 'mold'],
  'pest-control': ['pest', 'termite', 'cockroach', 'rat', 'ants', 'bees', 'snake'],
  'garden-outdoor': ['garden', 'lawn', 'tree', 'grass', 'weed', 'hedge'],
  'general-handyman': ['fix', 'repair', 'broken', 'install', 'mount'],
  'property-inspection': ['inspect', 'check the property', 'condition'],
  'pre-arrival-preparation': ['arrival', 'before we arrive', 'prepare', 'ventilat'],
};

function guessCategory(text: string, allowed: string[]): string | null {
  const t = text.toLowerCase();
  let best: { slug: string; score: number } | null = null;
  for (const slug of allowed) {
    const words = CATEGORY_KEYWORDS[slug] ?? slug.split('-');
    const score = words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { slug, score };
  }
  return best?.slug ?? null;
}

function urgencyFromText(text: string): Urgency {
  const t = text.toLowerCase();
  if (/(spark|burning smell|smoke|gas smell|electric shock|collaps|flood)/.test(t)) return 'SAFETY_RISK';
  if (/(urgent|no water|no power|leaking|overflow|asap|emergency)/.test(t)) return 'URGENT';
  return 'STANDARD';
}

const triage: MockGenerator = (c) => {
  const r = obj(c.request);
  const cat = obj(c.category);
  const text = `${str(r.title)}. ${str(r.description)}`;
  const current = (str(r.urgency) || 'STANDARD') as Urgency;
  const allowed = arr<{ slug: string }>(c.categories).map((x) => x.slug);
  const guessed = guessCategory(text, allowed);
  const missing: string[] = [];
  if (!Number(r.photosCount)) missing.push('Could you share two or three photos of the affected area?');
  if (!Number(r.preferredWindowsCount)) missing.push('Which dates and times suit a visit?');
  if (str(r.description).length < 80) missing.push('Could you describe when the problem started and how often it happens?');
  return {
    summary: `${firstSentence(str(r.description) || str(r.title))} Category: ${str(cat.name)}.`,
    suggestedCategorySlug: guessed && guessed !== str(cat.slug) ? guessed : null,
    suggestedUrgency: maxUrgency(current, r.safetyFlag ? 'SAFETY_RISK' : urgencyFromText(text)),
    inspectionNeeded: Boolean(cat.inspectionUsuallyRequired) || str(r.description).length > 300,
    missingInformation: missing,
    draftOwnerMessage: missing.length ? `Thank you for your request. To prepare an accurate quote: ${missing.join(' ')}` : null,
  };
};

const listingReview: MockGenerator = (c) => {
  const l = obj(c.listing);
  const comps = arr<{ basePricePaise: number }>(c.comparables).map((x) => x.basePricePaise).filter((x) => x > 0);
  const price = Number(l.basePricePaise) || 0;
  const completeness = [
    { item: 'title', status: str(l.title).length >= 10 ? 'OK' : str(l.title) ? 'WEAK' : 'MISSING', note: 'A specific title helps guests.' },
    { item: 'description', status: str(l.description).length >= 200 ? 'OK' : str(l.description) ? 'WEAK' : 'MISSING', note: 'Describe the space, the area and how to get there.' },
    { item: 'photos', status: Number(l.photoCount) >= 5 ? 'OK' : Number(l.photoCount) ? 'WEAK' : 'MISSING', note: `${Number(l.photoCount)} photo(s) uploaded.` },
    { item: 'pricing', status: price > 0 ? 'OK' : 'MISSING', note: 'Base nightly price.' },
    { item: 'capacity', status: Number(l.maxGuests) > 0 ? 'OK' : 'MISSING', note: `${Number(l.maxGuests)} guests, ${Number(l.beds)} beds.` },
    { item: 'cancellation policy', status: l.cancellationPolicyKey ? 'OK' : 'MISSING', note: str(l.cancellationPolicyKey) },
  ] as Array<{ item: string; status: 'OK' | 'MISSING' | 'WEAK'; note: string }>;
  const redFlags: Array<{ type: 'CONTACT_DETAILS' | 'MISLEADING_CLAIM' | 'CAPACITY_ANOMALY' | 'PRICE_ANOMALY' | 'OTHER'; detail: string }> = [];
  if (c.containsContactDetails) redFlags.push({ type: 'CONTACT_DETAILS', detail: `Contact details found in the text (${arr<string>(c.contactDetailTypes).join(', ')}).` });
  if (Number(l.maxGuests) > Math.max(1, Number(l.beds)) * 3) redFlags.push({ type: 'CAPACITY_ANOMALY', detail: 'Guest capacity looks high for the number of beds.' });
  if (/(guaranteed|best in india|100% safe|no\.? ?1)/i.test(`${str(l.title)} ${str(l.description)}`)) redFlags.push({ type: 'MISLEADING_CLAIM', detail: 'Absolute claims should be substantiated or removed.' });
  if (comps.length >= 2 && price > 0) {
    const min = Math.min(...comps);
    const max = Math.max(...comps);
    if (price < min * 0.5 || price > max * 2) redFlags.push({ type: 'PRICE_ANOMALY', detail: 'The nightly price is far outside comparable listings nearby.' });
  }
  const weak = completeness.filter((x) => x.status !== 'OK');
  return {
    overall: redFlags.length ? 'CONCERNS' : weak.length ? 'NEEDS_CHANGES' : 'LOOKS_GOOD',
    completeness,
    qualityFindings: weak.map((w) => `Improve the ${w.item}: ${w.note}`),
    redFlags,
    suggestedChangeRequests: [
      ...weak.map((w) => `Please improve the ${w.item}.`),
      ...redFlags.filter((f) => f.type === 'CONTACT_DETAILS').map(() => 'Please remove phone numbers, e-mail addresses and links from the listing text.'),
    ],
  };
};

const briefing: MockGenerator = (c) => {
  const q = obj(c.queues);
  const lists = obj(c.attention);
  const actions: Array<{ label: string; entityType: string; entityId: string; rationale: string; priority: number }> = [];
  for (const r of arr(lists.safetyRequests).slice(0, 2)) actions.push({ label: `Triage safety-flagged request ${str(r.reference)}`, entityType: 'SERVICE_REQUEST', entityId: str(r.id), rationale: `Waiting ${Number(r.ageHours)} h.`, priority: 1 });
  for (const b of arr(lists.expiringBookingRequests).slice(0, 2)) actions.push({ label: `Chase host on ${str(b.reference)}`, entityType: 'BOOKING', entityId: str(b.id), rationale: `Expires in ${Number(b.hoursLeft)} h.`, priority: 2 });
  for (const l of arr(lists.oldestListings).slice(0, 2)) actions.push({ label: `Review listing ${str(l.reference)}`, entityType: 'LISTING', entityId: str(l.id), rationale: `Waiting ${Number(l.waitingHours)} h.`, priority: 3 });
  for (const w of arr(lists.blockedWorkOrders).slice(0, 1)) actions.push({ label: `Unblock work order ${str(w.reference)}`, entityType: 'WORK_ORDER', entityId: str(w.id), rationale: `Blocked: ${str(w.reason)}.`, priority: 2 });
  for (const i of arr(lists.openIssues).slice(0, 1)) actions.push({ label: `Pick up issue ${str(i.reference)}`, entityType: 'ISSUE', entityId: str(i.id), rationale: `Open ${Number(i.ageHours)} h.`, priority: 3 });
  const parts = [
    Number(q.safetyRequests) ? `${Number(q.safetyRequests)} safety-flagged request(s) need attention.` : '',
    Number(q.listingsAwaitingReview) ? `${Number(q.listingsAwaitingReview)} listing(s) await review.` : '',
    Number(q.bookingRequestsNearExpiry) ? `${Number(q.bookingRequestsNearExpiry)} booking request(s) expire soon.` : '',
    Number(q.openIssues) ? `${Number(q.openIssues)} issue(s) are open.` : '',
  ].filter(Boolean);
  return {
    summary: parts.length ? parts.join(' ') : 'Queues are clear. No urgent items this morning.',
    highlights: Object.entries(q)
      .filter(([, v]) => Number(v) > 0)
      .slice(0, 6)
      .map(([k, v]) => ({ label: k.replace(/([A-Z])/g, ' $1').toLowerCase(), severity: Number(v) > 5 ? 'HIGH' : Number(v) > 2 ? 'MEDIUM' : 'LOW', metric: { count: Number(v) } })),
    risks: Number(q.safetyRequests) ? [{ label: 'Safety-flagged maintenance waiting', severity: 'HIGH' }] : [],
    suggestedActions: actions.slice(0, 6),
  };
};

const quoteDraft: MockGenerator = (c) => {
  const similar = arr<{ lines: Array<Record<string, unknown>> }>(c.similarApprovedQuotes);
  if (similar.length) {
    const lines = similar[0].lines.slice(0, 6).map((l) => ({
      description: str(l.description),
      quantity: str(l.quantity) || '1.000',
      unit: str(l.unit) || 'job',
      unitPricePaise: Number(l.unitPricePaise) || 0,
      lineType: str(l.lineType) || 'LABOUR',
      direction: str(l.direction) || 'ADD',
    }));
    return { lineItems: lines, outlierWarnings: [], rationale: 'Based on the most recent similar approved quote in this category.' };
  }
  return {
    lineItems: [
      { description: 'Labour', quantity: '1.000', unit: 'job', unitPricePaise: 150_000, lineType: 'LABOUR', direction: 'ADD' },
      { description: 'Materials (estimate)', quantity: '1.000', unit: 'set', unitPricePaise: 50_000, lineType: 'MATERIAL', direction: 'ADD' },
      { description: 'Travel', quantity: '1.000', unit: 'visit', unitPricePaise: 30_000, lineType: 'TRAVEL', direction: 'ADD' },
    ],
    outlierWarnings: ['No similar approved quotes yet; amounts are generic placeholders.'],
    rationale: 'Generic starting point. Adjust after inspection.',
  };
};

const providerShortlist: MockGenerator = (c) => ({
  ranked: arr<{ id: string; internalRating: number | null; jobs: number }>(c.providers)
    .sort((a, b) => (b.internalRating ?? 0) - (a.internalRating ?? 0) || b.jobs - a.jobs)
    .map((p, i) => ({ providerId: p.id, rank: i + 1, reason: `Rating ${p.internalRating ?? 'n/a'}, ${p.jobs} past job(s).` })),
});

const evidenceReview: MockGenerator = (c) => {
  const req = obj(c.requiredEvidence);
  const ev = arr<{ phase: string; capturedAt: string | null }>(c.evidence);
  const concerns: string[] = [];
  for (const phase of ['BEFORE', 'DURING', 'AFTER']) {
    const need = Number(req[phase] ?? 0);
    const have = ev.filter((e) => e.phase === phase).length;
    if (have < need) concerns.push(`${phase.toLowerCase()} evidence: ${have} of ${need}.`);
  }
  const firstVisit = arr<{ checkedInAt: string }>(c.visits).map((v) => v.checkedInAt).sort()[0];
  if (firstVisit && ev.some((e) => e.phase === 'AFTER' && e.capturedAt && e.capturedAt < firstVisit)) concerns.push('Some after-photos were captured before the first visit.');
  return {
    completeness: concerns.length ? 'INCOMPLETE' : 'COMPLETE',
    summary: `${ev.length} evidence file(s) and ${arr(c.checklistResults).length} checklist result(s) recorded.`,
    concerns,
  };
};

const issueSummary: MockGenerator = (c) => {
  const i = obj(c.issue);
  const booking = str(i.subjectType) === 'BOOKING';
  return {
    summary: firstSentence(str(i.description), 300),
    urgency: /(safety|injur|unsafe|danger)/i.test(str(i.description)) ? 'HIGH' : 'MEDIUM',
    resolutionOptions: booking
      ? [
          { option: 'Partial refund to the guest', policyReference: 'PARTIAL_REFUND' },
          { option: 'Adjust the owner payout', policyReference: 'PAYOUT_ADJUSTED' },
          { option: 'No action after review', policyReference: 'NO_ACTION_REQUIRED' },
        ]
      : [
          { option: 'Create a rework work order', policyReference: 'REWORK_DONE' },
          { option: 'No action after review', policyReference: 'NO_ACTION_REQUIRED' },
        ],
  };
};

const commissionInsights: MockGenerator = (c) => {
  const k = obj(c.commission);
  const eff = Number(k.effectiveBps);
  const bench = Number(k.benchmarkBps);
  return {
    observations: [
      bench ? `Effective rate ${(eff / 100).toFixed(2)} % is ${(((bench - eff) / bench) * 100).toFixed(1)} % below the benchmark.` : 'No enabled benchmark.',
    ],
    suggestions: bench && (bench - eff) / bench < 0.1 ? ['The discount is below the 10 % target; consider reviewing it.'] : ['The discount is within the 10–15 % target range.'],
  };
};

const leakage: MockGenerator = (c) => {
  const text = arr<{ body: string }>(c.messages).map((m) => m.body).join(' \n ');
  const hit = /(whats ?app|call me|pay (me )?direct|outside the (app|platform)|bank transfer|gpay|phonepe|paytm|nine|eight|seven|\[contact details hidden\])/i.exec(text);
  return { flagged: !!hit, reason: hit ? `Message mentions "${hit[0]}".` : null };
};

const listingWriter: MockGenerator = (c) => {
  const f = obj(c.facts);
  const type = str(f.propertyType).replace(/_/g, ' ').toLowerCase() || 'home';
  const amenities = arr<string>(f.amenities);
  const notes = str(c.ownerNotes);
  return {
    title: `${f.bedrooms ? `${Number(f.bedrooms)}-bedroom ` : ''}${type} in ${str(f.areaLabel) || str(f.city)}`.replace(/^./, (s) => s.toUpperCase()).slice(0, 80),
    description: [
      `A ${type} for up to ${Number(f.maxGuests)} guests in ${str(f.areaLabel) || str(f.city)}.`,
      notes ? notes.slice(0, 600) : 'Add a few lines about what makes your place special.',
      amenities.length ? `Guests have ${amenities.slice(0, 6).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    highlights: amenities.slice(0, 6),
  };
};

const priceSuggestion: MockGenerator = (c) => {
  const f = obj(c.facts);
  const comps = arr<{ basePricePaise: number; bedrooms: number }>(c.comparables).filter((x) => x.basePricePaise > 0);
  let suggested: number;
  let rationale: string;
  if (comps.length) {
    const sorted = comps.map((x) => x.basePricePaise).sort((a, b) => a - b);
    suggested = sorted[Math.floor(sorted.length / 2)];
    rationale = `Median of ${comps.length} published listing(s) in the same city.`;
  } else {
    suggested = Math.max(1, Number(f.bedrooms) || 1) * 250_000;
    rationale = 'No comparable listings yet; based on bedrooms.';
  }
  suggested = Math.round(suggested / 10_000) * 10_000;
  return { minNightlyPaise: Math.round(suggested * 0.85), suggestedNightlyPaise: suggested, maxNightlyPaise: Math.round(suggested * 1.15), rationale };
};

const requestAssistant: MockGenerator = (c) => {
  const text = str(c.ownerDescription);
  const cats = arr<{ slug: string; fields: Array<{ key: string; type: string; options: Array<{ value: string }> | null }> }>(c.categories);
  const slug = guessCategory(text, cats.map((x) => x.slug));
  const answers: Record<string, string | number | boolean | string[]> = {};
  const cat = cats.find((x) => x.slug === slug);
  const t = text.toLowerCase();
  for (const field of cat?.fields ?? []) {
    if (field.type === 'boolean') {
      const words = field.key.split('_').filter((w) => w.length > 3);
      if (words.some((w) => t.includes(w))) answers[field.key] = !/\b(no|not)\b/.test(t);
    }
  }
  return {
    categorySlug: slug,
    title: firstSentence(text, 80) || 'Maintenance request',
    intakeAnswers: answers,
    suggestedUrgency: urgencyFromText(text),
    notes: 'Please check every pre-filled answer before submitting.',
  };
};

const nlSearch: MockGenerator = (c) => {
  const q = str(c.query);
  const t = q.toLowerCase();
  const today = str(c.today);
  const guests = /(\d{1,2})\s*(people|guests|persons|adults|pax|of us)/.exec(t) ?? /for\s+(\d{1,2})\b/.exec(t);
  const price = /(?:under|below|max|less than|upto|up to)\s*(?:₹|rs\.?|inr)?\s*([\d,]+)\s*(k)?/.exec(t);
  const amenities = arr<{ slug: string; name: string }>(c.amenities).filter((a) => t.includes(a.name.toLowerCase()) || t.includes(a.slug.replace(/-/g, ' '))).map((a) => a.slug);
  if (/\bpool\b/.test(t)) amenities.push('pool');
  if (/\bwi-?fi\b/.test(t)) amenities.push('wifi');
  if (/\bpets?\b|dog/.test(t)) amenities.push('pet-friendly');
  const known = arr<{ slug: string }>(c.amenities).map((a) => a.slug);
  const type = arr<string>(c.propertyTypes).find((p) => t.includes(p.toLowerCase().replace(/_/g, ' ').replace('independent ', '')));
  const place = arr<{ city: string; state: string }>(c.knownPlaces).find((p) => t.includes(p.city.toLowerCase()) || t.includes(p.state.toLowerCase()));
  let checkIn: string | null = null;
  let checkOut: string | null = null;
  const iso = q.match(/\d{4}-\d{2}-\d{2}/g);
  if (iso && iso.length >= 2) [checkIn, checkOut] = [iso[0], iso[1]];
  else if (today && /(this|next) weekend/.test(t)) {
    let d = today;
    while (weekdayOf(d) !== 'FRI') d = addDays(d, 1);
    if (/next weekend/.test(t)) d = addDays(d, 7);
    checkIn = d;
    checkOut = addDays(d, 2);
  }
  const bedrooms = /(\d)\s*(bhk|bed ?rooms?)/.exec(t);
  return {
    q: place ? place.city : null,
    checkIn,
    checkOut,
    guests: guests ? Number(guests[1]) : null,
    minPricePaise: null,
    maxPricePaise: price ? Number(price[1].replace(/,/g, '')) * (price[2] ? 1000 : 1) * 100 : null,
    propertyType: (type as string | undefined) ?? null,
    amenities: [...new Set(amenities)].filter((a) => known.includes(a)),
    bedrooms: bedrooms ? Number(bedrooms[1]) : null,
    minRating: /top rated|highly rated|best rated/.test(t) ? 4 : null,
  };
};

export const MOCK_GENERATORS: Partial<Record<AiFeatureKey, MockGenerator>> = {
  admin_briefing: briefing,
  request_triage: triage,
  listing_review: listingReview,
  quote_draft: quoteDraft,
  provider_shortlist: providerShortlist,
  evidence_review: evidenceReview,
  issue_summary: issueSummary,
  commission_insights: commissionInsights,
  leakage_flag: leakage,
  listing_writer: listingWriter,
  price_suggestion: priceSuggestion,
  request_assistant: requestAssistant,
  nl_search: nlSearch,
};
