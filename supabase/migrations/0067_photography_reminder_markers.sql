-- Idempotency markers so the daily reminder functions don't re-draft the
-- same message every time they run -- same "timestamp marks it done"
-- pattern as payment_requested_at.
alter table opportunities add column if not exists shot_checkin_drafted_at timestamptz;
alter table opportunities add column if not exists gallery_delivery_drafted_at timestamptz;
alter table opportunities add column if not exists wedding_reminder_60d_drafted_at timestamptz;
alter table opportunities add column if not exists wedding_reminder_14d_drafted_at timestamptz;
