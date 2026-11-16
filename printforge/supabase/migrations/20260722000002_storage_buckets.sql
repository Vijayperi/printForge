-- S7: private object-storage buckets for model + thumbnail assets. Access is
-- service-role only (the worker + server routes); no public access, no RLS
-- policies needed.

insert into storage.buckets (id, name, public)
values
  ('models', 'models', false),
  ('thumbnails', 'thumbnails', false)
on conflict (id) do nothing;
