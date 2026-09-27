import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CustomerDetailSchema, LoginResponseSchema } from '@werkstatt/contracts';
import { TEST_PASSWORD, call, createCustomer, createHarness, expectOk, expectStatus, type Harness } from './support/harness';
import { setupWorkshop, type Workshop } from './support/scenario';

let h: Harness;
let w: Workshop;
beforeAll(async () => {
  h = await createHarness();
  w = await setupWorkshop(h);
});
afterAll(async () => h?.close());

describe('Kundenzugang sperren und wieder freischalten', () => {
  it('gesperrter Zugang kann durch die Werkstatt wieder freigeschaltet werden; nur mit Recht', async () => {
    const customer = await createCustomer(h, 'Freischaltung');
    expectOk(await call(h, 'POST', `/customers/${customer.customerId}/account/disable`, { token: w.service.token }), CustomerDetailSchema);
    expectStatus(await call(h, 'POST', '/auth/login', { body: { email: customer.email, password: TEST_PASSWORD } }), 403, 'account_disabled');
    expectStatus(await call(h, 'POST', `/customers/${customer.customerId}/account/enable`, { token: w.mechanic.token }), 403);
    const enabled = expectOk(await call(h, 'POST', `/customers/${customer.customerId}/account/enable`, { token: w.service.token }), CustomerDetailSchema);
    expect(enabled.accessStatus).toBe('active');
    expectOk(await call(h, 'POST', '/auth/login', { body: { email: customer.email, password: TEST_PASSWORD } }), LoginResponseSchema);
    expectStatus(await call(h, 'POST', `/customers/${customer.customerId}/account/enable`, { token: w.service.token }), 409, 'not_disabled');
  });
});
