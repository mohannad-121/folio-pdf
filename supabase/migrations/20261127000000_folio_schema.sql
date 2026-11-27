-- Folio PDF: application tables in a dedicated "folio" schema.
--
-- The backend creates these tables itself on first start (SQLAlchemy create_all), so running this
-- file is optional. Paste it into the Supabase SQL Editor (or use `supabase db push`) if you prefer
-- to manage the schema explicitly. It is idempotent: running it again changes nothing.
--
-- The schema is NOT exposed through Supabase's Data API (only "public" and "graphql_public" are by
-- default), RLS is enabled with no policies, and the anon/authenticated roles have no privileges,
-- so the publishable key can never read or write these tables. Only the backend, connecting as the
-- database owner through the pooler, uses them.

create schema if not exists folio;

-- Users: one row per Supabase Auth user (id = auth.users.id = the JWT "sub").
create table if not exists folio.users (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    varchar(320) not null,
  name                     varchar(200),
  created_at               timestamp without time zone not null default (now() at time zone 'utc'),
  plan                     varchar(16) not null default 'free',
  plan_status              varchar(32),
  plan_interval            varchar(16),
  paddle_customer_id       varchar(64),
  paddle_subscription_id   varchar(64),
  subscription_updated_at  timestamp without time zone,
  current_period_end       timestamp without time zone,
  trial_ends_at            timestamp without time zone,
  cancel_at                timestamp without time zone,
  trial_used               boolean not null default false
);
create index if not exists ix_users_email on folio.users (email);
create index if not exists ix_users_paddle_customer_id on folio.users (paddle_customer_id);
create index if not exists ix_users_paddle_subscription_id on folio.users (paddle_subscription_id);

-- Personal API keys (Max plan). Only a SHA-256 hash of each key is stored.
create table if not exists folio.api_keys (
  id            varchar(36) primary key,
  user_id       uuid not null references folio.users (id) on delete cascade,
  name          varchar(100) not null,
  prefix        varchar(32) not null,
  key_hash      varchar(64) not null,
  created_at    timestamp without time zone not null default (now() at time zone 'utc'),
  last_used_at  timestamp without time zone
);
create index if not exists ix_api_keys_user_id on folio.api_keys (user_id);
create unique index if not exists ix_api_keys_key_hash on folio.api_keys (key_hash);

-- Daily task counters per subject (a user id or "ip:<address>" for anonymous visitors).
create table if not exists folio.usage (
  id       serial primary key,
  subject  varchar(80) not null,
  day      date not null,
  count    integer not null default 0,
  constraint uq_usage_subject_day unique (subject, day)
);
create index if not exists ix_usage_subject on folio.usage (subject);

-- Processed Paddle webhook ids (idempotency).
create table if not exists folio.webhook_events (
  id           serial primary key,
  event_id     varchar(80) not null,
  type         varchar(80) not null,
  received_at  timestamp without time zone not null default (now() at time zone 'utc')
);
create unique index if not exists ix_webhook_events_event_id on folio.webhook_events (event_id);

-- Lock the schema down: RLS on with no policies, and no access for the API roles.
alter table folio.users          enable row level security;
alter table folio.api_keys       enable row level security;
alter table folio.usage          enable row level security;
alter table folio.webhook_events enable row level security;

revoke all on schema folio from anon, authenticated;
revoke all on all tables in schema folio from anon, authenticated;
revoke all on all sequences in schema folio from anon, authenticated;
alter default privileges in schema folio revoke all on tables from anon, authenticated;
alter default privileges in schema folio revoke all on sequences from anon, authenticated;
