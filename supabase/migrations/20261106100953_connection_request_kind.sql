-- Peer connections (mentor with mentor, student with student, or any two
-- members) get their own request kind. It lives in a migration of its own: a
-- new enum value cannot be used in the transaction that adds it.
alter type public.connection_request_kind add value if not exists 'connection';
