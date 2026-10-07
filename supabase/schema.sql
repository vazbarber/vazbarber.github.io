-- =====================================================================
--  Plataforma de marcações — base de dados (Supabase / PostgreSQL)
--  Copiar tudo isto para: Supabase → SQL Editor → New query → Run
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Serviços (corte, barba, etc.)
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id               serial primary key,
  name             text not null,
  description      text,
  duration_minutes int  not null check (duration_minutes between 5 and 480),
  price_eur        numeric(6,2),
  active           boolean not null default true,
  sort_order       int not null default 0
);

-- ---------------------------------------------------------------------
-- Horário de funcionamento. Pode haver várias linhas por dia
-- (ex.: 09:00–13:00 e 14:30–19:00 para incluir a pausa de almoço).
-- weekday: 1 = segunda ... 7 = domingo
-- ---------------------------------------------------------------------
create table if not exists public.business_hours (
  id         serial primary key,
  weekday    int  not null check (weekday between 1 and 7),
  open_time  time not null,
  close_time time not null,
  check (close_time > open_time)
);

-- ---------------------------------------------------------------------
-- Folgas, férias, consultas pessoais... (bloqueiam a agenda)
-- ---------------------------------------------------------------------
create table if not exists public.time_off (
  id        serial primary key,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  reason    text,
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------
-- Marcações
-- status: pending (à espera de aprovação) | confirmed | rejected | cancelled
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  service_id       int  not null references public.services(id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  customer_name    text not null check (length(customer_name) between 2 and 100),
  customer_email   text not null check (customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  customer_phone   text not null check (length(customer_phone) between 6 and 25),
  notes            text check (length(notes) <= 500),
  status           text not null default 'pending'
                   check (status in ('pending','confirmed','rejected','cancelled')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  reminder_sent_at timestamptz,
  check (ends_at > starts_at),
  -- Impede duas marcações ativas no mesmo horário (mesmo com pedidos em simultâneo)
  constraint no_overlap exclude using gist (
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('pending','confirmed'))
);

create index if not exists bookings_starts_at_idx on public.bookings (starts_at);

-- ---------------------------------------------------------------------
-- Quem pode gerir (a tua irmã). Basta inserir o email com que ela faz login.
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------
-- Vagas disponíveis para um dia e um serviço (calculado em hora de Lisboa).
-- Não devolve dados pessoais, por isso pode ser chamado pelo site público.
-- ---------------------------------------------------------------------
create or replace function public.available_slots(p_day date, p_service_id int)
returns table (slot_start timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_duration interval;
  v_min_lead constant interval := interval '2 hours';     -- antecedência mínima
  v_max_days constant int      := 60;                     -- quantos dias para a frente se pode marcar
  h record;
begin
  select make_interval(mins => s.duration_minutes) into v_duration
  from services s where s.id = p_service_id and s.active;

  -- As horas propostas seguem a duração do serviço (ex.: 45 min → 10:00, 10:45),
  -- assim os cortes encaixam seguidos sem deixar buracos na agenda.
  if v_duration is null
     or p_day < (now() at time zone 'Europe/Lisbon')::date
     or p_day > (now() at time zone 'Europe/Lisbon')::date + v_max_days then
    return;
  end if;

  for h in
    select open_time, close_time from business_hours
    where weekday = extract(isodow from p_day)::int
    order by open_time
  loop
    return query
      select s
      from generate_series(
             (p_day + h.open_time)  at time zone 'Europe/Lisbon',
             (p_day + h.close_time) at time zone 'Europe/Lisbon' - v_duration,
             v_duration) as s
      where s >= now() + v_min_lead
        and not exists (
          select 1 from bookings b
          where b.status in ('pending','confirmed')
            and tstzrange(b.starts_at, b.ends_at) && tstzrange(s, s + v_duration))
        and not exists (
          select 1 from time_off t
          where tstzrange(t.starts_at, t.ends_at) && tstzrange(s, s + v_duration));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Segurança (Row Level Security)
--  - Público: só lê serviços ativos e chama available_slots.
--  - Marcações novas são criadas pela função "book" (servidor).
--  - Só quem está na tabela admins vê/gere marcações e folgas.
-- ---------------------------------------------------------------------
alter table public.services       enable row level security;
alter table public.business_hours enable row level security;
alter table public.time_off       enable row level security;
alter table public.bookings       enable row level security;
alter table public.admins         enable row level security;

drop policy if exists "services public read" on public.services;
create policy "services public read" on public.services
  for select using (active or public.is_admin());

drop policy if exists "services admin write" on public.services;
create policy "services admin write" on public.services
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "hours public read" on public.business_hours;
create policy "hours public read" on public.business_hours
  for select using (true);

drop policy if exists "hours admin write" on public.business_hours;
create policy "hours admin write" on public.business_hours
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "time_off admin" on public.time_off;
create policy "time_off admin" on public.time_off
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bookings admin read" on public.bookings;
create policy "bookings admin read" on public.bookings
  for select using (public.is_admin());

drop policy if exists "admins self read" on public.admins;
create policy "admins self read" on public.admins
  for select using (public.is_admin());

-- Permissões de acesso (as regras acima continuam a limitar o que cada um vê)
grant usage on schema public to anon, authenticated;
grant select on public.services, public.business_hours to anon, authenticated;
grant insert, update, delete on public.services, public.business_hours to authenticated;
grant select, insert, update, delete on public.time_off to authenticated;
grant select on public.bookings, public.admins to authenticated;
grant usage on all sequences in schema public to authenticated;

grant execute on function public.available_slots(date, int) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- =====================================================================
--  DADOS INICIAIS — ajustar à vontade (também se pode editar depois em
--  Supabase → Table Editor)
-- =====================================================================
insert into public.services (name, description, duration_minutes, price_eur, sort_order)
select 'Corte de cabelo', null, 45, 10.00, 1
where not exists (select 1 from public.services);

-- Todos os dias: 10:00–12:00 e 14:00–16:00
insert into public.business_hours (weekday, open_time, close_time)
select d, t.open_time, t.close_time
from generate_series(1, 7) as d,
     (values (time '10:00', time '12:00'), (time '14:00', time '16:00')) as t(open_time, close_time)
where not exists (select 1 from public.business_hours);

-- ⚠️ TROCAR pelo email com que a tua irmã vai entrar na página de gestão
insert into public.admins (email) values ('email-da-tua-irma@exemplo.com')
on conflict do nothing;
