-- A message queued while a run is active is sent when that run finishes, never when it was stopped or failed.
ALTER TABLE queued_messages ADD COLUMN send_at_turn_end INTEGER NOT NULL DEFAULT 1;
