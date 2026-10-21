import { describe, expect, it } from 'vitest';
import { addDays, diffDays, eachNight, istDateOf, weekdayOf } from './dates';
import { evaluateDangerRules, intakeSchemaSchema, missingChecklistItems, missingEvidence, validateIntakeAnswers } from './intake';
import { maskContactDetails } from './masking';
import { maskPhone, normaliseIndianPhone } from './phone';
import { POLICIES, POLICY_KEYS } from './policies';
import { maxUrgency } from './enums';
import {
  allowedTargets,
  bookingMachine,
  canTransition,
  listingMachine,
  quoteMachine,
  serviceRequestMachine,
  STATE_MACHINES,
  workOrderMachine,
} from './state-machines';

describe('state machines', () => {
  it('rejects every transition that is not in the table (generated)', () => {
    for (const machine of Object.values(STATE_MACHINES)) {
      const states = [...new Set(machine.rules.flatMap((r) => [r.from, r.to]))];
      for (const from of states) {
        for (const to of states) {
          if (to === null) continue;
          for (const actor of ['OWNER', 'CUSTOMER', 'ADMIN', 'SYSTEM'] as const) {
            const listed = machine.rules.some((r) => r.from === from && r.to === to && r.actors.includes(actor));
            expect(canTransition(machine as never, from as never, to as never, actor)).toBe(listed);
          }
        }
      }
    }
  });

  it('never leaves terminal states except where the spec allows', () => {
    for (const machine of Object.values(STATE_MACHINES)) {
      for (const terminal of machine.terminal) {
        const exits = machine.rules.filter((r) => r.from === terminal);
        // Only a late payment may move an EXPIRED booking to CONFIRMED.
        const allowed = exits.filter((r) => !(machine === bookingMachine && r.from === 'EXPIRED' && r.to === 'CONFIRMED'));
        expect(allowed).toEqual([]);
      }
    }
  });

  it('encodes key actor rules', () => {
    expect(canTransition(quoteMachine, 'SENT', 'APPROVED', 'ADMIN')).toBe(false); // impersonation prohibited
    expect(canTransition(quoteMachine, 'SENT', 'APPROVED', 'OWNER')).toBe(true);
    expect(canTransition(workOrderMachine, 'COMPLETED', 'IN_PROGRESS', 'ADMIN')).toBe(false);
    expect(canTransition(workOrderMachine, 'IN_PROGRESS', 'CANCELLED', 'OWNER')).toBe(false);
    expect(canTransition(bookingMachine, 'AWAITING_PAYMENT', 'CONFIRMED', 'CUSTOMER')).toBe(false); // webhook only
    expect(canTransition(listingMachine, 'SUBMITTED', 'PUBLISHED', 'OWNER')).toBe(false);
    expect(allowedTargets(serviceRequestMachine, 'QUOTATION_SENT', 'OWNER').sort()).toEqual(
      ['APPROVED', 'CANCELLED', 'REJECTED', 'UNDER_REVIEW'].sort(),
    );
  });
});

describe('urgency', () => {
  it('can be raised but never lowered', () => {
    expect(maxUrgency('SAFETY_RISK', 'STANDARD')).toBe('SAFETY_RISK');
    expect(maxUrgency('STANDARD', 'URGENT')).toBe('URGENT');
  });
});

describe('dates', () => {
  it('handles calendar maths and IST', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-11-12', '2026-11-15')).toBe(3);
    expect(eachNight('2026-11-12', '2026-11-14')).toEqual(['2026-11-12', '2026-11-13']);
    expect(weekdayOf('2026-11-13')).toBe('FRI');
    expect(istDateOf(new Date('2026-10-20T19:00:00Z'))).toBe('2026-10-21'); // 00:30 IST next day
  });
});

describe('phone numbers', () => {
  it('normalises Indian mobiles and rejects others', () => {
    expect(normaliseIndianPhone('98765 43210')).toBe('+919876543210');
    expect(normaliseIndianPhone('+91-98765-43210')).toBe('+919876543210');
    expect(normaliseIndianPhone('09876543210')).toBe('+919876543210');
    expect(normaliseIndianPhone('919876543210')).toBe('+919876543210');
    expect(normaliseIndianPhone('+14155552671')).toBeNull();
    expect(normaliseIndianPhone('5876543210')).toBeNull(); // must start 6-9
    expect(maskPhone('+919876543210')).toBe('+91 ••••••3210');
  });
});

describe('contact masking (SPEC §7 rule 20)', () => {
  it('masks phones, e-mails and URLs but not dates or prices', () => {
    const r = maskContactDetails('Call me on 98765 43210 or +91-98765-43210, mail a.b@x.co, see www.example.com and airbnb.com/rooms/1');
    expect(r.masked).toBe(true);
    expect(r.text).not.toMatch(/98765|@|example|airbnb/);
    expect(maskContactDetails('Arriving 2026-11-12, budget ₹12,500 for 3 nights').masked).toBe(false);
    expect(maskContactDetails('write to me at name (at) gmail (dot) com').masked).toBe(true);
  });
});

describe('intake schemas and danger rules (SPEC §9)', () => {
  const schema = intakeSchemaSchema.parse({
    fields: [
      { key: 'power_outage', label: 'Power outage?', type: 'boolean', required: true },
      { key: 'sparking', label: 'Burning smell or sparking?', type: 'boolean', required: true },
      { key: 'area', label: 'Affected area', type: 'text', required: true, show_if: { field: 'power_outage', equals: false } },
    ],
    dangerRules: [{ when: { field: 'sparking', equals: true }, severity: 'SAFETY_RISK', guidanceKey: 'electrical.sparking' }],
  });

  it('validates required and conditional fields', () => {
    expect(validateIntakeAnswers(schema, { power_outage: true, sparking: false }).ok).toBe(true);
    const missing = validateIntakeAnswers(schema, { power_outage: false, sparking: false });
    expect(missing.errors).toEqual([{ field: 'area', code: 'REQUIRED' }]);
    expect(validateIntakeAnswers(schema, { power_outage: 'yes', sparking: false }).ok).toBe(false);
  });

  it('evaluates danger rules deterministically', () => {
    expect(evaluateDangerRules(schema, { sparking: true }).safetyFlag).toBe(true);
    expect(evaluateDangerRules(schema, { sparking: false }).safetyFlag).toBe(false);
  });

  it('checks checklist and evidence completeness', () => {
    const template = {
      items: [
        { key: 'cleared', label: 'Area cleared', type: 'BOOLEAN' as const, required: true },
        { key: 'photos', label: 'After photos', type: 'PHOTO' as const, required: true, minCount: 2 },
        { key: 'note', label: 'Note', type: 'TEXT' as const, required: false },
      ],
    };
    expect(missingChecklistItems(template, [{ itemKey: 'cleared', result: true }])).toEqual(['photos']);
    expect(missingChecklistItems(template, [{ itemKey: 'cleared', result: true }, { itemKey: 'photos', result: ['a', 'b'] }])).toEqual([]);
    expect(missingEvidence({ BEFORE: 1, DURING: 0, AFTER: 2 }, { BEFORE: 1, AFTER: 1 })).toEqual([
      { phase: 'AFTER', required: 2, present: 1 },
    ]);
  });
});

describe('policy registry', () => {
  it('has valid defaults for every key', () => {
    for (const key of POLICY_KEYS) {
      expect(() => POLICIES[key].schema.parse(POLICIES[key].defaultValue)).not.toThrow();
    }
    expect(POLICIES['commission.undercut_bps'].defaultValue).toBe(1000);
    expect(POLICIES['booking.hold_minutes'].defaultValue).toBe(15);
  });
});
