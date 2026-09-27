/**
 * Wiederkehrende Abläufe für Integrationstests (über die API, nicht an ihr vorbei).
 */
import {
  ApprovalRequestSchema,
  FileRefSchema,
  InvoiceSchema,
  WorkItemSchema,
  WorkOrderDetailSchema,
  type ApprovalLine,
  type WorkItemInput,
} from '@werkstatt/contracts';
import { maintenanceTypes } from '../../src/db/schema/index';
import {
  SAMPLE_PDF,
  call,
  createCustomer,
  createStaff,
  createVehicle,
  expectOk,
  uploadFile,
  type Harness,
  type TestUser,
} from './harness';

export interface Workshop {
  admin: TestUser;
  service: TestUser;
  mechanic: TestUser;
  oilChangeTypeId: string;
  brakeFluidTypeId: string;
}

export async function setupWorkshop(h: Harness): Promise<Workshop> {
  const [oil] = await h.db
    .insert(maintenanceTypes)
    .values({ key: 'oil_change', name: 'Ölwechsel', defaultIntervalKm: 15000, defaultIntervalMonths: 12, intervalOptions: [] })
    .onConflictDoNothing()
    .returning();
  const [fluid] = await h.db
    .insert(maintenanceTypes)
    .values({ key: 'brake_fluid', name: 'Bremsflüssigkeit', defaultIntervalKm: null, defaultIntervalMonths: 24, intervalOptions: [] })
    .onConflictDoNothing()
    .returning();
  return {
    admin: await createStaff(h, 'admin'),
    service: await createStaff(h, 'service'),
    mechanic: await createStaff(h, 'mechanic'),
    oilChangeTypeId: oil!.id,
    brakeFluidTypeId: fluid!.id,
  };
}

export async function customerWithVehicle(h: Harness, lastName = 'Kunde'): Promise<{ customer: TestUser; vehicleId: string }> {
  const customer = await createCustomer(h, lastName);
  const vehicleId = await createVehicle(h, customer.customerId!);
  return { customer, vehicleId };
}

export function item(title: string, extra: Partial<WorkItemInput> = {}): Partial<WorkItemInput> {
  return { kind: 'labor', title, quantity: 1, unit: 'Std', unitPriceCents: 9000, vatRateBp: 1900, ...extra };
}

export async function createWorkOrder(
  h: Harness,
  token: string,
  input: { customerId: string; vehicleId: string; title?: string; items?: Partial<WorkItemInput>[]; assigneeIds?: string[] },
  query?: Record<string, string>,
) {
  return expectOk(
    await call(h, 'POST', '/work-orders', {
      token,
      query,
      body: {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        title: input.title ?? '[TEST] Auftrag',
        items: input.items ?? [],
        assigneeIds: input.assigneeIds ?? [],
      },
    }),
    WorkOrderDetailSchema,
    201,
  );
}

export function line(title: string, unitPriceCents: number, extra: Partial<ApprovalLine> = {}): ApprovalLine {
  return { title, description: null, quantity: 1, unit: 'Stk', unitPriceCents, vatRateBp: 1900, maintenanceTypeId: null, ...extra };
}

export async function createAndSendApproval(h: Harness, token: string, workOrderId: string, lines: ApprovalLine[], title = '[TEST] Zusatzarbeit') {
  const draft = expectOk(
    await call(h, 'POST', `/work-orders/${workOrderId}/approvals`, {
      token,
      body: { kind: 'additional_work', title, summaryCustomer: 'Bei der Prüfung festgestellt.', lines, photoIds: [] },
    }),
    ApprovalRequestSchema,
    201,
  );
  return expectOk(await call(h, 'POST', `/approvals/${draft.id}/send`, { token }), ApprovalRequestSchema);
}

export async function decide(h: Harness, customerToken: string, approvalId: string, versionId: string, contentHash: string, decision: 'approved' | 'rejected') {
  return call(h, 'POST', `/approvals/${approvalId}/decision`, {
    token: customerToken,
    body: { versionId, contentHash, decision, channel: 'web' },
  });
}

export async function issueInvoice(h: Harness, token: string, input: { customerId: string; workOrderId?: string | null; totalGrossCents: number; number?: string; withPdf?: boolean }) {
  let documentFileId: string | null = null;
  if (input.withPdf) {
    documentFileId = expectOk(await uploadFile(h, token, 'rechnung.pdf', 'application/pdf', SAMPLE_PDF), FileRefSchema, 201).id;
  }
  const draft = expectOk(
    await call(h, 'POST', '/invoices', {
      token,
      body: { customerId: input.customerId, workOrderId: input.workOrderId ?? null, totalGrossCents: input.totalGrossCents, documentFileId },
    }),
    InvoiceSchema,
    201,
  );
  return expectOk(
    await call(h, 'POST', `/invoices/${draft.id}/issue`, { token, body: { invoiceNumber: input.number ?? `R-TEST-${Math.floor(Math.random() * 1e9)}` } }),
    InvoiceSchema,
  );
}

/** Auftrag mit erledigter Wartungsposition bis "Arbeiten erledigt" (work_completed). */
export async function workOrderWithFinishedMaintenance(h: Harness, w: Workshop, customerId: string, vehicleId: string, odometerKm = 50000) {
  const wo = await createWorkOrder(h, w.service.token, {
    customerId,
    vehicleId,
    assigneeIds: [w.mechanic.id],
    items: [item('Ölwechsel', { maintenanceTypeId: w.oilChangeTypeId })],
  });
  const itemId = wo.items[0]!.id;
  expectOk(await call(h, 'POST', `/work-items/${itemId}/start`, { token: w.mechanic.token }), WorkItemSchema);
  expectOk(
    await call(h, 'POST', `/work-items/${itemId}/finish`, { token: w.mechanic.token, body: { odometerKm, resultNotes: 'Öl und Filter gewechselt' } }),
    WorkItemSchema,
  );
  return { wo, itemId };
}
