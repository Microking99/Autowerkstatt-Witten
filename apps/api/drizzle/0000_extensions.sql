-- Erweiterungen, die das Schema benötigt.
-- citext: E-Mail-Adressen ohne Beachtung der Groß-/Kleinschreibung (users.email, customers.email).
-- gen_random_uuid() ist seit PostgreSQL 13 eingebaut, pgcrypto wird nicht benötigt.
CREATE EXTENSION IF NOT EXISTS citext;
