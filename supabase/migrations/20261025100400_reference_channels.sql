-- CornerOps One v0.2 — reference data: the channel catalog (global, read-only).
insert into public.channels (id, name, kind) values
  ('talabat', 'Talabat', 'marketplace'),
  ('deliveroo', 'Deliveroo', 'marketplace'),
  ('noon', 'Noon Food', 'marketplace'),
  ('keeta', 'Keeta', 'marketplace'),
  ('direct', 'Direct Website', 'owned'),
  ('whatsapp', 'WhatsApp', 'owned')
on conflict (id) do update set name = excluded.name, kind = excluded.kind;
