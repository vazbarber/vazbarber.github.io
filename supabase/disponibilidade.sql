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

-- Vagas: vêm dos turnos abertos nesse dia. As horas são propostas de 10 em
-- 10 minutos, mas só se não deixarem antes/depois um intervalo mais curto do
-- que o serviço mais curto (esse tempo ficaria perdido na agenda).
create or replace function public.available_slots(p_day date, p_service_id int)
returns table (slot_start timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_duration interval;
  v_min      interval;                                 -- duração do serviço mais curto
  v_step     constant interval := interval '10 minutes';
  v_min_lead constant interval := interval '2 hours';  -- antecedência mínima
  v_max_days constant int      := 75;                  -- até ~2 meses e meio
  h record;
begin
  select make_interval(mins => s.duration_minutes) into v_duration
  from services s where s.id = p_service_id and s.active;
  select make_interval(mins => min(s.duration_minutes)) into v_min
  from services s where s.active;

  if v_duration is null
     or p_day < (now() at time zone 'Europe/Lisbon')::date
     or p_day > (now() at time zone 'Europe/Lisbon')::date + v_max_days then
    return;
  end if;

  for h in
    select (p_day + p.start_time) at time zone 'Europe/Lisbon' as ps,
           (p_day + p.end_time)   at time zone 'Europe/Lisbon' as pe
    from availability a join periods p on p.key = a.period
    where a.day = p_day
    order by p.start_time
  loop
    return query
      with busy as (
        select b.starts_at as bs, b.ends_at as be from bookings b
        where b.status in ('pending','confirmed') and b.starts_at < h.pe and b.ends_at > h.ps
        union all
        select t.starts_at, t.ends_at from time_off t
        where t.starts_at < h.pe and t.ends_at > h.ps
      ),
      cand as (
        select c as s,
               -- tempo livre antes (desde o início do turno ou fim da marcação anterior)
               c - greatest(h.ps, coalesce((select max(be) from busy where be <= c), h.ps)) as gap_before,
               -- tempo livre depois (até ao fim do turno ou início da marcação seguinte)
               least(h.pe, coalesce((select min(bs) from busy where bs >= c + v_duration), h.pe)) - (c + v_duration) as gap_after
        from generate_series(h.ps, h.pe - v_duration, v_step) as c
        where c >= now() + v_min_lead
          and not exists (select 1 from busy where tstzrange(bs, be) && tstzrange(c, c + v_duration))
      )
      select cand.s from cand
      where (gap_before = interval '0' or gap_before >= v_min)
        and (gap_after  = interval '0' or gap_after  >= v_min);
  end loop;
end;
$$;
