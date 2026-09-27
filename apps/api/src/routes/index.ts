import type { App } from '../types';
import { healthRoutes } from './health';
import { authRoutes } from './auth';
import { userRoutes } from './users';
import { fileRoutes } from './files';
import { realtimeRoutes } from './realtime';
import { customerRoutes } from './customers';
import { vehicleRoutes } from './vehicles';
import { appointmentRoutes } from './appointments';
import { workOrderRoutes } from './workOrders';
import { approvalRoutes } from './approvals';
import { documentRoutes } from './documents';
import { messageRoutes } from './messages';
import { invoiceRoutes } from './invoices';
import { webhookRoutes } from './webhooks';
import { notificationRoutes } from './notifications';
import { settingsRoutes } from './settings';
import { publicRoutes } from './public';
import { dashboardRoutes } from './dashboard';
import { auditRoutes } from './audit';
import { privacyRoutes } from './privacy';

/** Registriert alle Routen unter /api/v1 (Vertrag: packages/contracts/src/api.ts). */
export async function registerRoutes(app: App): Promise<void> {
  await healthRoutes(app);
  await authRoutes(app);
  await userRoutes(app);
  await fileRoutes(app);
  await realtimeRoutes(app);
  await customerRoutes(app);
  await vehicleRoutes(app);
  await appointmentRoutes(app);
  await workOrderRoutes(app);
  await approvalRoutes(app);
  await documentRoutes(app);
  await messageRoutes(app);
  await invoiceRoutes(app);
  await webhookRoutes(app);
  await notificationRoutes(app);
  await settingsRoutes(app);
  await publicRoutes(app);
  await dashboardRoutes(app);
  await auditRoutes(app);
  await privacyRoutes(app);
}
