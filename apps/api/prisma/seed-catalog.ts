/** Development seed: service catalogue (SPEC §9.1–§9.4). Categories are data, never code. */
import type { ChecklistItem, IntakeSchema, RequiredEvidence } from '@propcare/shared';

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
  inspectionUsuallyRequired: boolean;
  safetyNotes?: string;
  intake: IntakeSchema;
  requiredEvidence: RequiredEvidence;
  checklist: ChecklistItem[];
}

const yesNo = (key: string, label: string, required = true) => ({ key, label, type: 'boolean' as const, required });
const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }));
const photos = (min = 2) => ({ key: 'after_photos', label: 'After photos', type: 'PHOTO' as const, required: true, minCount: min });
const cleared = { key: 'area_cleared', label: 'Work area made safe and cleared', type: 'BOOLEAN' as const, required: true };

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'electrical-repairs',
    name: 'Electrical repairs and safety checks',
    description: 'Faulty switches, sockets, wiring, MCB trips and safety checks by licensed electricians.',
    inspectionUsuallyRequired: true,
    safetyNotes: 'Never open distribution boards or touch exposed wiring. Isolate power at the main only if it is safe.',
    intake: {
      fields: [
        { key: 'affected_area', label: 'Which rooms or points are affected?', type: 'text', required: true },
        yesNo('power_outage', 'Is there a full power outage?'),
        yesNo('sparking_or_burning', 'Is there any sparking or burning smell?'),
        yesNo('shock_reported', 'Has anyone felt an electric shock?', false),
      ],
      dangerRules: [
        { when: { field: 'sparking_or_burning', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'electrical.sparking' },
        { when: { field: 'shock_reported', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'electrical.shock' },
      ],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 2 },
    checklist: [
      { key: 'power_isolated', label: 'Power isolated before work', type: 'BOOLEAN', required: true },
      { key: 'fault_found', label: 'Fault identified (describe)', type: 'TEXT', required: true },
      { key: 'tested_after', label: 'Circuit tested after repair', type: 'BOOLEAN', required: true },
      cleared,
      photos(2),
    ],
  },
  {
    slug: 'plumbing-leak-repair',
    name: 'Plumbing and leak repair',
    description: 'Leaks, taps, drains, toilets, geysers and water supply problems.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        yesNo('water_supply_affected', 'Is the water supply affected?'),
        { key: 'leak_location', label: 'Where is the leak?', type: 'text', required: true },
        yesNo('leak_visible', 'Is water visibly leaking now?'),
        yesNo('near_electrics', 'Is the water near electrical points?', false),
      ],
      dangerRules: [
        { when: { field: 'leak_visible', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'plumbing.active_leak' },
        { when: { field: 'near_electrics', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'plumbing.flooding' },
      ],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 1 },
    checklist: [
      { key: 'water_shut_off', label: 'Water shut off before work', type: 'BOOLEAN', required: true },
      { key: 'leak_fixed', label: 'Leak fixed and joints sealed', type: 'BOOLEAN', required: true },
      { key: 'pressure_tested', label: 'Pressure / flow tested', type: 'BOOLEAN', required: true },
      cleared,
      photos(1),
    ],
  },
  {
    slug: 'painting-wall-finishing',
    name: 'Painting and wall finishing',
    description: 'Interior and exterior painting, putty, texture and damp-patch treatment.',
    inspectionUsuallyRequired: true,
    intake: {
      fields: [
        { key: 'rooms_surfaces', label: 'Rooms or surfaces to paint', type: 'text', required: true },
        { key: 'approx_area_sqft', label: 'Approximate area (sq ft)', type: 'number', required: false, min: 10, max: 100000 },
        { key: 'interior_exterior', label: 'Interior or exterior?', type: 'select', required: true, options: opts('interior', 'exterior', 'both') },
        { key: 'desired_finish', label: 'Desired finish', type: 'select', required: false, options: opts('matte', 'satin', 'gloss', 'texture') },
        yesNo('damp_present', 'Are there damp patches?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 2, DURING: 0, AFTER: 2 },
    checklist: [
      { key: 'surfaces_prepared', label: 'Surfaces prepared and primed', type: 'BOOLEAN', required: true },
      { key: 'coats_applied', label: 'Number of coats applied', type: 'NUMBER', required: true },
      { key: 'furniture_protected', label: 'Furniture and floors protected', type: 'BOOLEAN', required: true },
      cleared,
      photos(2),
    ],
  },
  {
    slug: 'flooring-tiling',
    name: 'Flooring, tiling and grouting',
    description: 'Cracked tiles, regrouting, marble polishing and floor repairs.',
    inspectionUsuallyRequired: true,
    intake: {
      fields: [
        { key: 'damaged_area', label: 'Where is the damage?', type: 'text', required: true },
        { key: 'floor_type', label: 'Floor type', type: 'select', required: false, options: opts('tile', 'marble', 'wood', 'vinyl', 'other', 'not_sure') },
        { key: 'approx_size_sqft', label: 'Approximate size (sq ft)', type: 'number', required: false, min: 1, max: 100000 },
        yesNo('site_visit_needed', 'Do you think a site visit is needed?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 2 },
    checklist: [{ key: 'level_checked', label: 'Level and finish checked', type: 'BOOLEAN', required: true }, cleared, photos(2)],
  },
  {
    slug: 'carpentry-doors-windows',
    name: 'Carpentry, doors, windows, locks and fittings',
    description: 'Doors that stick, broken locks, hinges, windows, wardrobes and fittings.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        { key: 'item_type', label: 'What needs attention?', type: 'select', required: true, options: opts('door', 'window', 'lock', 'cabinet', 'other') },
        { key: 'issue_detail', label: 'Describe the problem', type: 'textarea', required: true },
        yesNo('security_concern', 'Is the property insecure because of this?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 1 },
    checklist: [{ key: 'operation_tested', label: 'Opens, closes and locks correctly', type: 'BOOLEAN', required: true }, cleared, photos(1)],
  },
  {
    slug: 'roof-waterproofing',
    name: 'Roof repair and waterproofing',
    description: 'Terrace and roof leaks, seepage, damaged tiles and waterproofing.',
    inspectionUsuallyRequired: true,
    safetyNotes: 'Work at height is done only by trained crews with fall protection.',
    intake: {
      fields: [
        { key: 'problem', label: 'What is the problem?', type: 'select', required: true, options: opts('leak', 'seepage', 'damaged_tiles', 'other') },
        yesNo('active_water_ingress', 'Is water coming in right now?'),
        yesNo('structural_concern', 'Any sagging, cracks or movement in the ceiling or roof?'),
      ],
      dangerRules: [{ when: { field: 'structural_concern', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'structural.risk' }],
    },
    requiredEvidence: { BEFORE: 2, DURING: 1, AFTER: 2 },
    checklist: [
      { key: 'safety_harness', label: 'Fall protection used', type: 'BOOLEAN', required: true },
      { key: 'water_test', label: 'Water test after repair passed', type: 'BOOLEAN', required: true },
      cleared,
      photos(2),
    ],
  },
  {
    slug: 'deep-cleaning',
    name: 'Deep cleaning and post-work cleaning',
    description: 'Whole-home deep cleaning, post-renovation cleaning and mould treatment.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        { key: 'rooms', label: 'Rooms to clean', type: 'multiselect', required: true, options: opts('bedrooms', 'kitchen', 'bathrooms', 'living', 'balcony', 'whole_property') },
        yesNo('post_work', 'Is this after construction or repair work?', false),
        yesNo('mould_present', 'Is there visible mould?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 2 },
    checklist: [
      { key: 'kitchen_done', label: 'Kitchen degreased', type: 'BOOLEAN', required: false },
      { key: 'bathrooms_done', label: 'Bathrooms descaled and sanitised', type: 'BOOLEAN', required: true },
      { key: 'waste_removed', label: 'Waste removed', type: 'BOOLEAN', required: true },
      photos(2),
    ],
  },
  {
    slug: 'pest-control',
    name: 'Pest control through approved personnel',
    description: 'Termites, cockroaches, rodents, bees and wasps — treated by approved personnel only.',
    inspectionUsuallyRequired: true,
    safetyNotes: 'Treatments use approved chemicals; occupants and pets may need to stay away for some hours.',
    intake: {
      fields: [
        { key: 'pest_type', label: 'Which pest?', type: 'select', required: true, options: opts('termites', 'cockroaches', 'rodents', 'bees_wasps', 'snakes', 'other') },
        yesNo('hive_or_snake_present', 'Is there a hive, nest or snake on site now?'),
        yesNo('children_or_pets', 'Are children or pets on site?', false),
      ],
      dangerRules: [{ when: { field: 'hive_or_snake_present', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'pest.hazard' }],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 1 },
    checklist: [
      { key: 'chemicals_used', label: 'Chemicals and dosage used', type: 'TEXT', required: true },
      { key: 'occupants_briefed', label: 'Re-entry time communicated', type: 'BOOLEAN', required: true },
      photos(1),
    ],
  },
  {
    slug: 'garden-outdoor',
    name: 'Garden, lawn, vegetation and outdoor upkeep',
    description: 'Mowing, pruning, weeding, tree trimming and outdoor upkeep.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        { key: 'approx_area_sqft', label: 'Approximate area (sq ft)', type: 'number', required: false, min: 10, max: 1000000 },
        { key: 'work_needed', label: 'Work needed', type: 'multiselect', required: true, options: opts('mowing', 'pruning', 'weeding', 'tree_trimming', 'planting') },
        yesNo('water_available', 'Is water available on site?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 1, DURING: 0, AFTER: 2 },
    checklist: [{ key: 'green_waste_removed', label: 'Green waste removed', type: 'BOOLEAN', required: true }, photos(2)],
  },
  {
    slug: 'general-handyman',
    name: 'General handyman repairs',
    description: 'Small fixes: mounting, curtain rods, minor repairs and installations.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        { key: 'task_list', label: 'List the tasks', type: 'textarea', required: true },
        yesNo('materials_available', 'Are the materials already at the property?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 0, DURING: 0, AFTER: 1 },
    checklist: [{ key: 'tasks_done', label: 'All listed tasks done', type: 'BOOLEAN', required: true }, cleared, photos(1)],
  },
  {
    slug: 'property-inspection',
    name: 'Property inspection / condition check',
    description: 'A walk-through of the property with a written condition report and photos.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        { key: 'inspection_type', label: 'Type of check', type: 'select', required: true, options: opts('routine', 'after_monsoon', 'after_storm', 'before_sale_or_let', 'other') },
        { key: 'focus_areas', label: 'Anything to focus on?', type: 'textarea', required: false },
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 0, DURING: 4, AFTER: 0 },
    checklist: [
      { key: 'exterior_checked', label: 'Exterior and roof checked from ground level', type: 'BOOLEAN', required: true },
      { key: 'utilities_checked', label: 'Water, power and drainage checked', type: 'BOOLEAN', required: true },
      { key: 'report_summary', label: 'Condition summary', type: 'TEXT', required: true },
    ],
  },
  {
    slug: 'pre-arrival-preparation',
    name: 'Pre-arrival preparation (cleaning, ventilation, utilities checklist)',
    description: 'Get the property ready before you or your guests arrive.',
    inspectionUsuallyRequired: false,
    intake: {
      fields: [
        { key: 'arrival_date', label: 'Arrival date', type: 'date', required: true },
        { key: 'guests_expected', label: 'Guests expected', type: 'number', required: false, min: 1, max: 50 },
        { key: 'utilities_check', label: 'Utilities to check', type: 'multiselect', required: false, options: opts('water', 'power', 'gas', 'internet') },
        yesNo('groceries', 'Stock basic groceries?', false),
      ],
      dangerRules: [],
    },
    requiredEvidence: { BEFORE: 0, DURING: 0, AFTER: 2 },
    checklist: [
      { key: 'aired_out', label: 'Rooms aired out', type: 'BOOLEAN', required: true },
      { key: 'linen_ready', label: 'Linen and towels ready', type: 'BOOLEAN', required: true },
      { key: 'utilities_ok', label: 'Utilities working', type: 'BOOLEAN', required: true },
      photos(2),
    ],
  },
];

export const SEED_AMENITIES = [
  ['wifi', 'Wi-Fi', 'Essentials', 'wifi'],
  ['air-conditioning', 'Air conditioning', 'Essentials', 'snowflake'],
  ['kitchen', 'Kitchen', 'Essentials', 'utensils'],
  ['washing-machine', 'Washing machine', 'Essentials', 'shirt'],
  ['hot-water', 'Hot water', 'Essentials', 'droplet'],
  ['power-backup', 'Power backup', 'Essentials', 'battery'],
  ['parking', 'Free parking', 'Facilities', 'car'],
  ['pool', 'Pool', 'Facilities', 'waves'],
  ['garden', 'Garden', 'Facilities', 'flower'],
  ['bbq', 'Barbecue area', 'Facilities', 'flame'],
  ['caretaker', 'Caretaker on site', 'Services', 'user'],
  ['housekeeping', 'Daily housekeeping', 'Services', 'sparkles'],
  ['pet-friendly', 'Pet friendly', 'Policies', 'paw'],
  ['workspace', 'Dedicated workspace', 'Work', 'laptop'],
  ['tv', 'TV', 'Entertainment', 'tv'],
  ['sea-view', 'Sea view', 'Views', 'sun'],
  ['mountain-view', 'Mountain view', 'Views', 'mountain'],
  ['first-aid', 'First-aid kit', 'Safety', 'cross'],
  ['fire-extinguisher', 'Fire extinguisher', 'Safety', 'shield'],
] as const;

export const SEED_SERVICE_AREAS = [
  { name: 'North Goa', state: 'Goa', district: 'North Goa', pinCodes: ['403507', '403508', '403509', '403510', '403511', '403515', '403516', '403517', '403519'], offersStays: true },
  { name: 'Bengaluru Central', state: 'Karnataka', district: 'Bengaluru Urban', pinCodes: ['560001', '560008', '560025', '560034', '560038', '560071', '560095', '560102'], offersStays: true },
  { name: 'Pune', state: 'Maharashtra', district: 'Pune', pinCodes: ['411001', '411004', '411006', '411007', '411038', '411045'], offersStays: true },
  { name: 'Lonavala–Khandala', state: 'Maharashtra', district: 'Pune', pinCodes: ['410401', '410403'], offersStays: true },
  { name: 'Kochi', state: 'Kerala', district: 'Ernakulam', pinCodes: ['682001', '682002', '682011', '682030'], offersStays: true },
  { name: 'Dehradun–Mussoorie', state: 'Uttarakhand', district: 'Dehradun', pinCodes: ['248001', '248009', '248179'], offersStays: true },
  { name: 'Udaipur', state: 'Rajasthan', district: 'Udaipur', pinCodes: ['313001', '313004'], offersStays: true },
];
