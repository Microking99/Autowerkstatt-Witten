/**
 * App-Routen (Expo Router) und Deep-Link-Ziele. Beschreibung: docs/ansichten-und-routen.md
 * Deep Links enthalten nur Pfade und IDs, nie Inhalte oder Geheimnisse.
 */
import type { Role } from './enums';

export const APP_SCHEME = 'autowerkstatt';

/** Einfache Query-Erzeugung ohne Abhängigkeit von URLSearchParams (React Native). */
export function toQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const routes = {
  root: () => '/',
  login: (next?: string) => (next ? `/anmelden?weiter=${encodeURIComponent(next)}` : '/anmelden'),
  invitation: (token: string) => `/einladung/${token}`,
  forgotPassword: () => '/passwort-vergessen',
  resetPassword: (token: string) => `/passwort-neu/${token}`,
  qr: (token: string) => `/q/${token}`,
  share: (token: string) => `/f/${token}`,
  paymentReturn: (invoiceId: string) => `/zahlung/rueckkehr?rechnung=${invoiceId}`,
  notAvailable: () => '/nicht-verfuegbar',

  customer: {
    home: () => '/kunde',
    vehicles: () => '/kunde/fahrzeuge',
    vehicle: (id: string) => `/kunde/fahrzeuge/${id}`,
    serviceHistory: (vehicleId: string) => `/kunde/fahrzeuge/${vehicleId}/servicehistorie`,
    serviceEntry: (vehicleId: string, entryId: string) => `/kunde/fahrzeuge/${vehicleId}/servicehistorie/${entryId}`,
    shares: (vehicleId: string) => `/kunde/fahrzeuge/${vehicleId}/teilen`,
    workOrders: () => '/kunde/auftraege',
    workOrder: (id: string) => `/kunde/auftraege/${id}`,
    chat: (workOrderId: string) => `/kunde/auftraege/${workOrderId}/chat`,
    approval: (workOrderId: string, requestId: string) => `/kunde/auftraege/${workOrderId}/freigaben/${requestId}`,
    appointments: () => '/kunde/termine',
    requestAppointment: (vehicleId?: string) => (vehicleId ? `/kunde/termine/anfragen?fahrzeug=${vehicleId}` : '/kunde/termine/anfragen'),
    appointment: (id: string) => `/kunde/termine/${id}`,
    messages: () => '/kunde/nachrichten',
    documents: () => '/kunde/dokumente',
    invoices: () => '/kunde/rechnungen',
    invoice: (id: string) => `/kunde/rechnungen/${id}`,
    account: () => '/kunde/konto',
  },

  mechanic: {
    home: () => '/mechaniker',
    workOrder: (id: string) => `/mechaniker/auftraege/${id}`,
    workItem: (workOrderId: string, itemId: string) => `/mechaniker/auftraege/${workOrderId}/positionen/${itemId}`,
    finding: (workOrderId: string) => `/mechaniker/auftraege/${workOrderId}/feststellung`,
    checklist: (workOrderId: string) => `/mechaniker/auftraege/${workOrderId}/checkliste`,
    sync: () => '/mechaniker/sync',
    account: () => '/mechaniker/konto',
  },

  workshop: {
    home: () => '/werkstatt',
    calendar: () => '/werkstatt/kalender',
    appointmentRequests: () => '/werkstatt/kalender/anfragen',
    newAppointment: () => '/werkstatt/termine/neu',
    appointment: (id: string) => `/werkstatt/termine/${id}`,
    customers: () => '/werkstatt/kunden',
    newCustomer: () => '/werkstatt/kunden/neu',
    customer: (id: string) => `/werkstatt/kunden/${id}`,
    vehicles: () => '/werkstatt/fahrzeuge',
    newVehicle: () => '/werkstatt/fahrzeuge/neu',
    vehicle: (id: string) => `/werkstatt/fahrzeuge/${id}`,
    workOrders: (filter?: Record<string, string>) => `/werkstatt/auftraege${toQuery(filter)}`,
    newWorkOrder: () => '/werkstatt/auftraege/neu',
    workOrder: (id: string) => `/werkstatt/auftraege/${id}`,
    workOrderTab: (id: string, tab: WorkOrderTab) => `/werkstatt/auftraege/${id}/${tab}`,
    newApproval: (workOrderId: string) => `/werkstatt/auftraege/${workOrderId}/freigaben/neu`,
    approval: (workOrderId: string, requestId: string) => `/werkstatt/auftraege/${workOrderId}/freigaben/${requestId}`,
    messages: () => '/werkstatt/nachrichten',
    invoices: () => '/werkstatt/rechnungen',
    invoice: (id: string) => `/werkstatt/rechnungen/${id}`,
    maintenance: () => '/werkstatt/wartungen',
    users: () => '/werkstatt/benutzer',
    user: (id: string) => `/werkstatt/benutzer/${id}`,
    settings: () => '/werkstatt/einstellungen',
    audit: () => '/werkstatt/protokoll',
    account: () => '/werkstatt/konto',
  },
} as const;

export const WORK_ORDER_TABS = ['annahme', 'arbeiten', 'fotos', 'dokumente', 'chat', 'freigaben', 'rechnung', 'verlauf'] as const;
export type WorkOrderTab = (typeof WORK_ORDER_TABS)[number];

export function homeForRole(role: Role): string {
  switch (role) {
    case 'customer':
      return routes.customer.home();
    case 'mechanic':
      return routes.mechanic.home();
    case 'admin':
    case 'service':
      return routes.workshop.home();
  }
}

/** Welche Rollen einen Bereich öffnen dürfen (Oberfläche; die API prüft zusätzlich). */
export function areaForPath(path: string): 'customer' | 'mechanic' | 'workshop' | 'public' {
  if (path.startsWith('/kunde')) return 'customer';
  if (path.startsWith('/mechaniker')) return 'mechanic';
  if (path.startsWith('/werkstatt')) return 'workshop';
  return 'public';
}

/**
 * Prüft ein `weiter`-Ziel nach der Anmeldung: nur interne, relative Pfade
 * (Schutz vor offenen Weiterleitungen).
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('://') || next.includes('\\')) return null;
  return next;
}
