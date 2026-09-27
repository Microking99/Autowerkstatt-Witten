ALTER TABLE "intakes" ADD COLUMN "first_confirmed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "intakes" SET "first_confirmed_at" = "confirmed_at" WHERE "confirmed_at" IS NOT NULL;
