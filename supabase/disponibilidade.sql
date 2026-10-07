-- =====================================================================
--  Horário flexível: a dona define, dia a dia, se abre de manhã,
--  à tarde, o dia todo ou se fecha. Dias sem nada definido = fechado.
--  (Correr DEPOIS do schema.sql)
-- =====================================================================

-- Turnos e as suas horas (editáveis na agenda)
create table if not exists public.periods (
  key        text primary key check (key in ('manha', 'tarde')),
  label      text not null,
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time)
);

insert into public.periods (key, label, start_time, end_time) values
  ('manha', 'Manhã', '10:00', '12:00'),
  ('tarde', 'Tarde', '14:00', '16:00')
on conflict (key) do nothing;

-- Uma linha por cada turno aberto num dia
create table if not exists public.availability (
  day    date not null,
  period text not null references public.periods(key),
  primary key (day, period)
);

alter table public.periods      enable row level security;
alter table public.availability enable row level security;

drop policy if exists "periods public read" on public.periods;
create policy "periods public read" on public.periods for select using (true);
drop policy if exists "periods admin write" on public.periods;
create policy "periods admin write" on public.periods
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "availability public read" on public.availability;
create policy "availability public read" on public.availability for select using (true);
drop policy if exists "availability admin write" on public.availability;
create policy "availability admin write" on public.availability
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.periods, public.availability to anon, authenticated;
grant insert, update, delete on public.periods, public.availability to authenticated;
grant all on public.periods, public.availability to service_role;

-- Vagas: agora vêm dos turnos abertos nesse dia (e não do horário semanal)
create or replace function public.available_slots(p_day date, p_service_id int)
returns table (slot_start timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_duration interval;
  v_min_lead constant interval := interval '2 hours';  -- antecedência mínima
  v_max_days constant int      := 75;                  -- até ~2 meses e meio
  h record;
begin
  select make_interval(mins => s.duration_minutes) into v_duration
  from services s where s.id = p_service_id and s.active;

  if v_duration is null
     or p_day < (now() at time zone 'Europe/Lisbon')::date
     or p_day > (now() at time zone 'Europe/Lisbon')::date + v_max_days then
    return;
  end if;

  -- As horas propostas seguem a duração do serviço (ex.: 45 min → 10:00, 10:45)
  for h in
    select p.start_time as open_time, p.end_time as close_time
    from availability a join periods p on p.key = a.period
    where a.day = p_day
    order by p.start_time
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
