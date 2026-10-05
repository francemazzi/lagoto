CREATE INDEX transcript_run ON transcript(run_id,first_seq);
CREATE INDEX runs_task ON runs(task_id,created_at);
CREATE INDEX criteria_task ON criteria(task_id,created_at);
CREATE INDEX verifications_task ON verifications(task_id,created_at);
CREATE INDEX checkpoints_task ON checkpoints(task_id,created_at);
CREATE INDEX queued_task ON queued_messages(task_id,state,created_at);
