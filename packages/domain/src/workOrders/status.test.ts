import { describe, expect, it } from 'vitest';
import type { Permission } from '@werkstatt/contracts';
import { admin, grant, mechanic, service } from '../testing/fixtures';
import { canTransitionWorkOrder, computeApprovalOverview, computeStatusTriple, type WorkItemStatusInput } from './status';

const perms = (list: Permission[]): ReadonlySet<Permission> => new Set(list);
const item = (authorization: WorkItemStatusInput['authorization'], executionStatus: WorkItemStatusInput['executionStatus']): WorkItemStatusInput => ({
  authorization,
  executionStatus,
});

describe('Arbeitsstatus: Übergänge', () => {
  const full = admin().permissions;

  it('folgt der Kette Entwurf bis Abgeholt', () => {
    const done = [item('agreed', 'done')];
    expect(canTransitionWorkOrder('draft', 'open', { items: [], permissions: full }).allowed).toBe(true);
    expect(canTransitionWorkOrder('open', 'in_progress', { items: [], permissions: full }).allowed).toBe(true);
    expect(canTransitionWorkOrder('in_progress', 'work_completed', { items: done, permissions: full }).allowed).toBe(true);
    expect(canTransitionWorkOrder('work_completed', 'completed', { items: done, permissions: full }).allowed).toBe(true);
    expect(canTransitionWorkOrder('completed', 'picked_up', { items: done, permissions: full }).allowed).toBe(true);
  });

  it('verbietet Sprünge und gleiche Status', () => {
    expect(canTransitionWorkOrder('open', 'completed', { items: [], permissions: full })).toMatchObject({ allowed: false, code: 'TRANSITION_NOT_ALLOWED' });
    expect(canTransitionWorkOrder('draft', 'in_progress', { items: [], permissions: full }).allowed).toBe(false);
    expect(canTransitionWorkOrder('open', 'open', { items: [], permissions: full })).toMatchObject({ code: 'SAME_STATUS' });
    expect(canTransitionWorkOrder('picked_up', 'completed', { items: [], permissions: full }).allowed).toBe(false);
  });

  it('work_completed nur, wenn alle ausführbaren Positionen erledigt oder nicht durchgeführt sind', () => {
    const open = [item('agreed', 'done'), item('approved', 'paused')];
    expect(canTransitionWorkOrder('in_progress', 'work_completed', { items: open, permissions: full })).toMatchObject({
      allowed: false,
      code: 'ITEMS_NOT_FINISHED',
    });
    const finished = [item('agreed', 'done'), item('approved', 'not_done'), item('rejected', 'planned'), item('withdrawn', 'planned')];
    expect(canTransitionWorkOrder('in_progress', 'work_completed', { items: finished, permissions: full }).allowed).toBe(true);
  });

  it('warnt, wenn beim Abschluss noch Positionen auf Kundenfreigabe warten', () => {
    const r = canTransitionWorkOrder('in_progress', 'work_completed', { items: [item('agreed', 'done'), item('pending_approval', 'planned')], permissions: full });
    expect(r).toEqual({ allowed: true, warnings: ['PENDING_APPROVAL_ITEMS'] });
  });

  it('completed nur aus work_completed und nur mit workOrders.completeReview', () => {
    const done = [item('agreed', 'done')];
    expect(canTransitionWorkOrder('in_progress', 'completed', { items: done, permissions: full }).allowed).toBe(false);
    expect(canTransitionWorkOrder('work_completed', 'completed', { items: done, permissions: mechanic().permissions })).toMatchObject({
      allowed: false,
      code: 'MISSING_PERMISSION',
    });
    expect(canTransitionWorkOrder('work_completed', 'completed', { items: done, permissions: mechanic([grant('workOrders.completeReview')]).permissions }).allowed).toBe(true);
    expect(canTransitionWorkOrder('work_completed', 'completed', { items: done, permissions: service().permissions }).allowed).toBe(true);
  });

  it('cancelled nur vor completed', () => {
    for (const from of ['draft', 'open', 'in_progress', 'work_completed'] as const) {
      expect(canTransitionWorkOrder(from, 'cancelled', { items: [], permissions: full }).allowed).toBe(true);
    }
    for (const from of ['completed', 'picked_up'] as const) {
      expect(canTransitionWorkOrder(from, 'cancelled', { items: [], permissions: full })).toMatchObject({ allowed: false, code: 'TRANSITION_NOT_ALLOWED' });
    }
    expect(canTransitionWorkOrder('open', 'cancelled', { items: [], permissions: mechanic().permissions }).allowed).toBe(false);
  });

  it('Mechaniker kann Arbeiten beginnen und als erledigt melden, Kunden nichts', () => {
    const m = mechanic().permissions;
    expect(canTransitionWorkOrder('open', 'in_progress', { items: [], permissions: m }).allowed).toBe(true);
    expect(canTransitionWorkOrder('in_progress', 'work_completed', { items: [item('agreed', 'done')], permissions: m }).allowed).toBe(true);
    expect(canTransitionWorkOrder('draft', 'open', { items: [], permissions: m }).allowed).toBe(false);
    expect(canTransitionWorkOrder('open', 'in_progress', { items: [], permissions: perms([]) }).allowed).toBe(false);
  });

  it('Wiederaufnahme nach work_completed nur, wenn eine ausführbare Position offen ist', () => {
    expect(canTransitionWorkOrder('work_completed', 'in_progress', { items: [item('agreed', 'done')], permissions: full })).toMatchObject({ code: 'NO_OPEN_ITEMS' });
    expect(canTransitionWorkOrder('work_completed', 'in_progress', { items: [item('agreed', 'done'), item('approved', 'planned')], permissions: full }).allowed).toBe(true);
  });
});

describe('Freigabestatus', () => {
  it('none ohne gesendete Anfragen, pending wenn eine wartet, decided wenn alle entschieden', () => {
    expect(computeApprovalOverview([]).status).toBe('none');
    expect(computeApprovalOverview([{ status: 'draft' }, { status: 'withdrawn' }]).status).toBe('none');
    const pending = computeApprovalOverview([{ status: 'approved' }, { status: 'pending_customer' }]);
    expect(pending).toMatchObject({ status: 'pending', pendingCount: 1, approvedCount: 1 });
    expect(computeApprovalOverview([{ status: 'approved' }, { status: 'rejected' }])).toMatchObject({ status: 'decided', approvedCount: 1, rejectedCount: 1 });
  });
});

describe('Status-Dreiklang', () => {
  it('hält Arbeits-, Freigabe- und Zahlungsstatus getrennt', () => {
    const triple = computeStatusTriple({
      workStatus: 'completed',
      approvalRequests: [{ status: 'pending_customer' }],
      invoices: [
        { invoice: { status: 'issued', totalGrossCents: 10_000, dueDate: '2026-09-01' }, payments: [{ amountCents: 4_000 }], refunds: [] },
      ],
      today: '2026-09-26',
      readyForPickupAt: '2026-09-25T15:00:00Z',
    });
    expect(triple).toEqual({ work: 'completed', approval: 'pending', payment: 'partially_paid', overdue: true, readyForPickup: true, pendingApprovalCount: 1 });
  });

  it('ohne Rechnung no_invoice; Entwürfe zählen nicht; nach Abholung nicht mehr abholbereit', () => {
    const triple = computeStatusTriple({
      workStatus: 'picked_up',
      approvalRequests: [],
      invoices: [{ invoice: { status: 'draft', totalGrossCents: 10_000, dueDate: null }, payments: [], refunds: [] }],
      today: '2026-09-26',
      readyForPickupAt: '2026-09-25T15:00:00Z',
      pickedUpAt: '2026-09-26T09:00:00Z',
    });
    expect(triple.payment).toBe('no_invoice');
    expect(triple.readyForPickup).toBe(false);
    expect(triple.approval).toBe('none');
  });

  it('fasst mehrere Rechnungen über die Summen zusammen; nur stornierte ergeben cancelled', () => {
    const paid = { invoice: { status: 'issued' as const, totalGrossCents: 5_000, dueDate: null }, payments: [{ amountCents: 5_000 }], refunds: [] };
    const open = { invoice: { status: 'issued' as const, totalGrossCents: 5_000, dueDate: null }, payments: [], refunds: [] };
    const cancelled = { invoice: { status: 'cancelled' as const, totalGrossCents: 5_000, dueDate: null }, payments: [], refunds: [] };
    const base = { workStatus: 'completed' as const, approvalRequests: [], today: '2026-09-26', readyForPickupAt: null };
    expect(computeStatusTriple({ ...base, invoices: [paid, open] }).payment).toBe('partially_paid');
    expect(computeStatusTriple({ ...base, invoices: [paid, cancelled] }).payment).toBe('paid');
    expect(computeStatusTriple({ ...base, invoices: [cancelled] }).payment).toBe('cancelled');
  });
});
