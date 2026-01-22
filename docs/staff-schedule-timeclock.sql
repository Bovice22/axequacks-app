-- Staff scheduling + time clock (Axe Quacks)
alter table if exists staff_users
  add column if not exists role_label text,
  add column if not exists hourly_rate_cents integer;

create table if not exists staff_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  shift_date date not null,
  start_min integer not null,
  end_min integer not null,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists staff_shifts_staff_user_idx on staff_shifts (staff_user_id);
create index if not exists staff_shifts_date_idx on staff_shifts (shift_date);

create table if not exists staff_time_entries (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  clock_in_ts timestamptz not null,
  clock_out_ts timestamptz,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists staff_time_entries_staff_user_idx on staff_time_entries (staff_user_id);
create index if not exists staff_time_entries_clock_in_idx on staff_time_entries (clock_in_ts);
