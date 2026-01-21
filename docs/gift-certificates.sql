-- Gift certificates (Axe Quacks)
create table if not exists gift_certificates (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  customer_id uuid not null references customers(id),
  original_amount_cents integer not null,
  balance_cents integer not null,
  status text not null default 'ACTIVE',
  expires_at timestamptz not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists gift_certificate_redemptions (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references gift_certificates(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  amount_cents integer not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (certificate_id, booking_id)
);

create index if not exists gift_certificates_code_idx on gift_certificates (code);
create index if not exists gift_certificate_redemptions_booking_idx on gift_certificate_redemptions (booking_id);
