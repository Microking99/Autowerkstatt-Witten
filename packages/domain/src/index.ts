/**
 * @werkstatt/domain: reine Geschäftslogik ohne I/O für API (`apps/api`) und App (`apps/app`).
 *
 * Keine Datenbank, kein Netzwerk, kein Dateisystem, keine Uhr: Zeitpunkte werden immer als
 * Parameter (`now`, `today`) übergeben. Plattformneutral (Node, React Native, Browser).
 * Regeln und Quellen: docs/rollen-und-rechte.md, docs/datenmodell.md, docs/anforderungen.md.
 */
export * from './common/result';
export * from './common/dates';
export * from './common/hash';
export * from './common/money';
export * from './format';
export * from './permissions';
export * from './workOrders';
export * from './approvals';
export * from './payments';
export * from './serviceHistory';
export * from './appointments';
export * from './vehicles';
export * from './shares';
export * from './intake';
