-- S12: quotes carry the pricing-relevant config hash so we can tell a fresh quote
-- from a stale one (the print_configuration row mutates in place per design
-- version, so configuration_id alone can't detect a pricing change).
alter table public.quotes add column config_hash text not null default '';

-- Fast lookup of the active quote for a (configuration, config hash).
create index quotes_config_hash_idx
  on public.quotes (configuration_id, config_hash, status);
