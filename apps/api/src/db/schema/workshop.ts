/** 2. Werkstatt und Stammdaten */
import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, time, uuid } from 'drizzle-orm/pg-core';
import { createdAt, paymentProviderSettingEnum, pk, resourceKindEnum, updatedAt } from './common';
import { users } from './accounts';

export interface OpeningHoursEntry {
  weekday: number;
  opens: string;
  closes: string;
}

/** Voreinstellung je Ereignis und Kanal, falls der Benutzer nichts festgelegt hat. */
export type NotificationDefaults = Partial<Record<string, { push?: boolean; email?: boolean }>>;

export const workshopSettings = pgTable(
  'workshop_settings',
  {
    id: integer('id').primaryKey().default(1),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    vatId: text('vat_id'),
    iban: text('iban'),
    bic: text('bic'),
    bankName: text('bank_name'),
    openingHours: jsonb('opening_hours').$type<OpeningHoursEntry[]>().notNull().default([]),
    paymentTermDays: integer('payment_term_days').notNull().default(14),
    notificationDefaults: jsonb('notification_defaults').$type<NotificationDefaults>().notNull().default({}),
    paymentProvider: paymentProviderSettingEnum('payment_provider').notNull().default('none'),
    /** Händlerkennung; der API-Schlüssel steht nie in der Datenbank, nur in Umgebungsvariablen */
    sumupMerchantCode: text('sumup_merchant_code'),
    updatedAt: updatedAt(),
  },
  (t) => [check('workshop_settings_single_row', sql`${t.id} = 1`)],
);

export interface IntervalOption {
  km: number | null;
  months: number | null;
  label: string;
}

export const maintenanceTypes = pgTable('maintenance_types', {
  id: pk(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  defaultIntervalKm: integer('default_interval_km'),
  defaultIntervalMonths: integer('default_interval_months'),
  intervalOptions: jsonb('interval_options').$type<IntervalOption[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const resources = pgTable('resources', {
  id: pk(),
  name: text('name').notNull(),
  kind: resourceKindEnum('kind').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staffWorkingHours = pgTable(
  'staff_working_hours',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** 1 = Montag … 7 = Sonntag */
    weekday: integer('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
  },
  (t) => [check('staff_working_hours_weekday', sql`${t.weekday} BETWEEN 1 AND 7`)],
);

/** Fortlaufende Nummern (Kundennummer, Auftragsnummer je Jahr), atomar per UPDATE … RETURNING. */
export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});
