-- CornerOps One v0.2 — tenancy, identity and memberships
--
-- Supabase Auth owns identity (auth.users). CornerOps One owns membership and
-- authorization: which organizations a user belongs to, with which role, and
-- which locations they may access. No credentials are stored in public tables.

begin;

-- ---------------------------------------------------------------------------
-- Organizations: demo workspaces are flagged so simulated activity can never
-- touch production tenants.

alter table public.organizations
  add column if not exists is_demo boolean not null default false,
  add column if not exists legal_name text;

comment on column public.organizations.is_demo is
  'Demo workspaces receive simulated traffic and can be reset. Never true for customer organizations.';

-- ---------------------------------------------------------------------------
-- Profiles: display data for auth users (no passwords, no tokens).

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Memberships. An invitation is a membership with status 'invited', an
-- invited_email and no user yet; it is claimed when that email signs in.

create table public.organization_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  text not null references public.organizations (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete cascade,
  invited_email    text,
  role             text not null check (role in ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'BRANCH_MANAGER', 'KITCHEN_STAFF')),
  status           text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  invited_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint memberships_identity check (user_id is not null or invited_email is not null),
  constraint memberships_invite_state check (status <> 'invited' or user_id is null),
  unique (organization_id, user_id)
);

create unique index organization_memberships_pending_email_idx
  on public.organization_memberships (organization_id, lower(invited_email))
  where user_id is null;
create index organization_memberships_user_idx on public.organization_memberships (user_id) where status = 'active';

-- Location grants for location-restricted roles (BRANCH_MANAGER, KITCHEN_STAFF).
-- OWNER / ADMIN / OPERATIONS_MANAGER implicitly access every location.
create table public.membership_locations (
  membership_id    uuid not null references public.organization_memberships (id) on delete cascade,
  location_id      text not null references public.locations (id) on delete cascade,
  organization_id  text not null references public.organizations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (membership_id, location_id)
);

create index membership_locations_location_idx on public.membership_locations (location_id);

-- ---------------------------------------------------------------------------
-- Retire the v0.1 placeholder users table (identity now lives in auth.users).

alter table public.alerts drop constraint if exists alerts_acknowledged_by_fkey;
alter table public.alerts alter column acknowledged_by type uuid using null;
alter table public.alerts
  add constraint alerts_acknowledged_by_fkey foreign key (acknowledged_by) references auth.users (id) on delete set null;

drop table if exists public.users cascade;

-- updated_at maintenance for new tables
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger organization_memberships_touch before update on public.organization_memberships for each row execute function public.touch_updated_at();

commit;
