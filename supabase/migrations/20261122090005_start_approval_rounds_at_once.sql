begin;

-- Approval e-mails were meant to start a round at once, like request e-mails,
-- but the trigger compared next_attempt_at with now(), the start of the
-- transaction that writes the row: a row written within that transaction is
-- always later, so the condition never held and every approval e-mail waited
-- for the scheduled workflow. Compared with the clock when the row is written,
-- an e-mail due now starts a round; one waiting out its twelve hours does not.
drop trigger start_approval_email_round on private.approval_email_queue;
create trigger start_approval_email_round after insert or update of status on private.approval_email_queue
for each row when (new.status = 'pending' and new.next_attempt_at <= clock_timestamp())
execute function private.start_notification_round();

commit;
