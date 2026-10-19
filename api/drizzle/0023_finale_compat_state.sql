ALTER TABLE "users" ADD COLUMN "notif_read" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- the notification read-ids move out of the compat snapshot into the user's own row; the snapshot itself is
-- dropped by the finale boot once it is drained (the counters re-derive from the rows, the undo buffer has
-- been empty since the last mock route went native)
UPDATE "users" u SET "notif_read" = COALESCE(
  (SELECT c.data->'notifRead'->u.id->'ids' FROM compat_state c WHERE c.key = 'main'),
  '[]'::jsonb);
