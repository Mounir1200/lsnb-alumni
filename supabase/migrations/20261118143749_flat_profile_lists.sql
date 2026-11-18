begin;

-- A member's specialties and mentoring topics are flat lists of text, as the
-- profile form writes them. A direct API call could store a nested array,
-- which the weekly Highlight then copied into its immutable snapshot and could
-- not read: its generator and its fallback both stopped on it, so that week's
-- edition never appeared. The database now refuses any other shape; the API
-- also reads only the text of snapshots taken before this rule.
alter table public.profiles
  add constraint profiles_specialties_flat check (coalesce(array_ndims(specialties), 1) = 1),
  add constraint profiles_mentoring_topics_flat check (coalesce(array_ndims(mentoring_topics), 1) = 1);

commit;
