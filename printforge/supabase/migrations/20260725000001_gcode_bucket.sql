-- S12: private bucket for sliced gcode assets (written by the slicing.run worker).
-- Service-role only, like the other object buckets.
insert into storage.buckets (id, name, public)
values ('gcode', 'gcode', false)
on conflict (id) do nothing;
