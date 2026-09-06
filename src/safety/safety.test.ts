import { describe, it, expect } from 'vitest';
import { placeholderContent as C } from '../content/placeholder';
import { evaluateRedFlags, redFlagScreenReady } from './redFlags';
import { applyPrecautionHide, evaluatePrecautions } from './precautions';
import { evaluateEscalationRules, thresholdValue } from './escalationRules';
import { resolveTrafficLight } from '../episode/trafficLight';
import { selectPublished } from '../content/routing';

describe('red-flag wall', () => {
  it('is ready when published flags exist', () => {
    expect(redFlagScreenReady(C)).toBe(true);
  });

  it('stops on any positive answer', () => {
    const out = evaluateRedFlags(C, { rf_trauma: 'yes' });
    expect(out.stopped).toBe(true);
  });

  it('does not stop when every answer is negative', () => {
    const answers = Object.fromEntries(C.redFlags.map((f) => [f.id, 'no']));
    expect(evaluateRedFlags(C, answers).stopped).toBe(false);
  });
});

describe('precaution engine', () => {
  it('may stop, never substitutes', () => {
    const out = evaluatePrecautions(C, ['recent_surgery']);
    expect(out.kind).toBe('stop');
  });

  it('hides listed exercises only', () => {
    const out = evaluatePrecautions(C, ['balance_concern']);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    const all = selectPublished(C.exercises);
    const hidden = applyPrecautionHide(all, out.hideIds);
    expect(hidden.find((e) => e.id === 'lb_ex_sit_stand')).toBeUndefined();
    expect(hidden.length).toBe(all.length - 1);
  });

  it('none of these does not hide anything', () => {
    const out = evaluatePrecautions(C, ['none']);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.hideIds.size).toBe(0);
  });
});

describe('thresholds — missing means do not fire', () => {
  it('reads authored values', () => {
    expect(thresholdValue(C, 'nrs_referral')).toBe(8);
  });

  it('returns null when unpublished', () => {
    const bundle = { ...C, thresholds: C.thresholds.map((t) => ({ ...t, reviewedBy: '' })) };
    expect(thresholdValue(bundle, 'nrs_referral')).toBeNull();
  });
});

describe('traffic light', () => {
  it('green when pain is unchanged or eased', () => {
    expect(resolveTrafficLight(C, 5, 4)).toBe('green');
    expect(resolveTrafficLight(C, 5, 5)).toBe('green');
  });

  it('amber on a mild increase', () => {
    expect(resolveTrafficLight(C, 4, 6)).toBe('amber');
  });

  it('red on a larger increase', () => {
    expect(resolveTrafficLight(C, 3, 8)).toBe('red');
  });

  it('refuses to colour when the amber window is unpublished', () => {
    const bundle = { ...C, thresholds: [] };
    expect(resolveTrafficLight(bundle, 4, 7)).toBeNull();
  });
});

describe('escalation rules', () => {
  it('fires unrouted', () => {
    expect(evaluateEscalationRules(C, null, { unrouted: true })?.reason).toBe('unrouted');
  });

  it('fires high baseline only when threshold exists', () => {
    expect(evaluateEscalationRules(C, null, { nrsNow: 9 })?.reason).toBe('high_baseline');
    const bundle = { ...C, thresholds: [] };
    expect(evaluateEscalationRules(bundle, null, { nrsNow: 9 })).toBeNull();
  });
});
