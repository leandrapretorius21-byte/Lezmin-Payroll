-- =============================================================
-- STEP 1 of 2: tables and security for Lezmin Cleaners Payroll.
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run again: it only creates what is missing.
-- =============================================================

-- Who may use the site. Nobody else can read or change anything,
-- even if they somehow create a login.
create table if not exists public.app_users (
  email text primary key,
  role  text not null default 'user' check (role in ('admin', 'user')),
  added_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin');
$$;

-- Staff
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  emp_no text not null unique,
  name text not null,
  known_as text,
  id_number text,
  dob date,
  phone text,
  occupation text default 'Cleaner',
  site text not null default 'O',
  start_date date,
  day_rate_override numeric,
  pb_pct numeric,
  uif boolean not null default true,
  bank text,
  account text,
  branch text,
  notes text,
  status text not null default 'active' check (status in ('active', 'left')),
  left_date date,
  left_reason text,
  sort_order int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pay rules and company details (one row)
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null
);

-- The month he is working on. One row with month = 'current'.
-- His figures stay here until he presses "Start next month", which empties them.
create table if not exists public.runs (
  month text primary key,
  period text,                                   -- which month is being paid, e.g. '2026-09'
  pay_date date,
  entries jsonb not null default '{}'::jsonb,   -- { staff_id: { unpaid: 1, sundays: 2, ... } }
  locked jsonb,
  updated_at timestamptz not null default now()
);
alter table public.runs drop constraint if exists runs_month_check;
alter table public.runs add column if not exists period text;
-- If an earlier version saved September under '2026-09', carry it over to the working month
insert into public.runs (month, period, pay_date, entries)
select 'current', month, pay_date, entries from public.runs where month ~ '^\d{4}-\d{2}$' order by month desc limit 1
on conflict (month) do nothing;

-- Save one person's figures without overwriting anyone else's
create or replace function public.save_entry(p_month text, p_staff uuid, p_entry jsonb) returns void
language sql security invoker set search_path = public as $$
  insert into public.runs (month, entries) values (p_month, jsonb_build_object(p_staff::text, p_entry))
  on conflict (month) do update
    set entries = public.runs.entries || jsonb_build_object(p_staff::text, p_entry), updated_at = now()
    where public.runs.locked is null;
$$;

-- ---------- security (row level security) ----------
alter table public.app_users enable row level security;
alter table public.staff     enable row level security;
alter table public.settings  enable row level security;
alter table public.runs      enable row level security;

drop policy if exists "see own access" on public.app_users;
create policy "see own access" on public.app_users for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "members read staff"  on public.staff;
drop policy if exists "members write staff" on public.staff;
create policy "members read staff"  on public.staff for select to authenticated using (public.is_member());
create policy "members write staff" on public.staff for all    to authenticated using (public.is_member()) with check (public.is_member());

drop policy if exists "members read settings" on public.settings;
drop policy if exists "admin writes settings" on public.settings;
create policy "members read settings" on public.settings for select to authenticated using (public.is_member());
create policy "admin writes settings" on public.settings for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "members read runs"   on public.runs;
drop policy if exists "members add runs"    on public.runs;
drop policy if exists "members change runs" on public.runs;
drop policy if exists "admin deletes runs"  on public.runs;
create policy "members read runs"   on public.runs for select to authenticated using (public.is_member());
create policy "members add runs"    on public.runs for insert to authenticated with check (public.is_member());
create policy "members change runs" on public.runs for update to authenticated using (public.is_member()) with check (public.is_member());
create policy "admin deletes runs"  on public.runs for delete to authenticated using (public.is_admin());

-- Nobody signed out can touch anything
revoke all on public.app_users, public.staff, public.settings, public.runs from anon;

-- =============================================================
-- LAST STEP: give yourself and him access. Change the emails, then run
-- just these two lines (select them and press Run).
-- 'admin' can also change the pay rules on the Settings page.
-- =============================================================
-- insert into public.app_users (email, role) values ('you@example.com', 'admin') on conflict (email) do update set role = excluded.role;
-- insert into public.app_users (email, role) values ('him@example.com', 'user')  on conflict (email) do update set role = excluded.role;
