-- Next features schema (run in Supabase SQL editor)

create extension if not exists "pgcrypto";

-- Booking policies
create table if not exists public.booking_policies (
  id uuid primary key default gen_random_uuid(),
  cancel_window_hours int not null default 24,
  reschedule_window_hours int not null default 12,
  refund_policy text not null default 'FULL_BEFORE_WINDOW',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_booking_policies_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booking_policies_set_updated_at on public.booking_policies;
create trigger booking_policies_set_updated_at
before update on public.booking_policies
for each row execute function public.set_booking_policies_updated_at();

-- Blackout rules (manual blocks)
create table if not exists public.blackout_rules (
  id uuid primary key default gen_random_uuid(),
  date_key text not null,
  start_min int,
  end_min int,
  activity text not null default 'ALL',
  reason text,
  created_at timestamptz not null default now()
);

-- Buffer rules (pre/post buffers for a booking)
create table if not exists public.buffer_rules (
  id uuid primary key default gen_random_uuid(),
  activity text not null default 'ALL',
  before_min int not null default 0,
  after_min int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Promo codes
create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null default 'PERCENT',
  discount_value int not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int,
  redemptions_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Add-ons
create table if not exists public.add_ons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents int not null default 0,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table if exists public.add_ons
  add column if not exists image_url text;

-- POS sales
create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  staff_id text,
  subtotal_cents int not null default 0,
  tax_cents int not null default 0,
  total_cents int not null default 0,
  payment_intent_id text,
  status text not null default 'PAID',
  created_at timestamptz not null default now()
);

create table if not exists public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  item_id uuid not null references public.add_ons(id) on delete restrict,
  name text not null,
  price_cents int not null default 0,
  quantity int not null default 1,
  line_total_cents int not null default 0,
  created_at timestamptz not null default now()
);

-- Waivers
create table if not exists public.customer_waivers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  signer_name text not null,
  signer_email text,
  signature_text text not null,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.waiver_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  token text not null unique,
  status text not null default 'PENDING',
  sent_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists waiver_requests_booking_unique on public.waiver_requests(booking_id);

-- Booking change requests (cancel/reschedule/refund)
create table if not exists public.booking_changes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  change_type text not null,
  status text not null default 'PENDING',
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  note text
);

-- Webhook idempotency + errors
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  status text not null default 'processing',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text,
  unique (provider, event_id)
);

create table if not exists public.webhook_failures (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text,
  payload_json jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

-- Reminders / notification queue (provider integration later)
create table if not exists public.message_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  recipient text not null,
  template_key text not null,
  payload_json jsonb,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Waivers
create table if not exists public.waiver_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  template_id uuid references public.waiver_templates(id) on delete set null,
  signed_name text not null,
  signed_at timestamptz not null default now(),
  ip_address text
);
