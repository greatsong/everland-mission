-- 에버랜드 미션: 표와 함수. 여러 번 실행해도 된다.
-- 표는 RLS로 직접 접근을 막고, 코드를 확인하는 함수로만 읽고 쓴다.
-- 입장 코드와 본부 코드는 _private/setup.sql 끝에서 넣는다(저장소에 올리지 않는다).

create table if not exists evm_config (
  key text primary key,
  value text not null
);

create table if not exists evm_submissions (
  team_id int not null check (team_id between 1 and 6),
  mission_id text not null,
  photo text not null,
  cheers int not null default 0,
  created_at timestamptz not null default now(),
  primary key (team_id, mission_id)
);

create table if not exists evm_notices (
  id bigint generated always as identity primary key,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists evm_checkins (
  team_id int primary key check (team_id between 1 and 6),
  checked_at timestamptz not null default now()
);

alter table evm_config enable row level security;
alter table evm_submissions enable row level security;
alter table evm_notices enable row level security;
alter table evm_checkins enable row level security;

-- 코드가 맞으면 'team' 또는 'admin', 틀리면 null
create or replace function evm_login(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_code = (select value from evm_config where key = 'admin_code') then 'admin'
    when p_code = (select value from evm_config where key = 'join_code') then 'team'
  end
$$;

create or replace function evm_require(p_code text, p_admin boolean default false) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_role text := evm_login(p_code);
begin
  if v_role is null or (p_admin and v_role <> 'admin') then
    raise exception 'EVM_BAD_CODE' using errcode = 'P0001';
  end if;
end $$;

-- 전체 상태(사진 본문 제외). 화면이 주기적으로 부른다.
create or replace function evm_state(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  return json_build_object(
    'submissions', coalesce((
      select json_agg(json_build_object(
        'team_id', team_id, 'mission_id', mission_id, 'cheers', cheers, 'at', created_at
      ) order by created_at desc) from evm_submissions), '[]'::json),
    'notice', (select json_build_object('id', id, 'body', body, 'at', created_at)
               from evm_notices order by id desc limit 1),
    'checkins', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'at', checked_at)) from evm_checkins), '[]'::json),
    'team_count', coalesce((select value::int from evm_config where key = 'team_count'), 6),
    'now', now()
  );
end $$;

create or replace function evm_submit(p_code text, p_team int, p_mission text, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  if p_photo not like 'data:image/jpeg;base64,%' or length(p_photo) > 400000 then
    raise exception 'EVM_BAD_PHOTO' using errcode = 'P0001';
  end if;
  if length(p_mission) > 40 then
    raise exception 'EVM_BAD_MISSION' using errcode = 'P0001';
  end if;
  insert into evm_submissions (team_id, mission_id, photo)
  values (p_team, p_mission, p_photo)
  on conflict (team_id, mission_id)
  do update set photo = excluded.photo, cheers = 0, created_at = now();
end $$;

create or replace function evm_remove(p_code text, p_team int, p_mission text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  delete from evm_submissions where team_id = p_team and mission_id = p_mission;
end $$;

create or replace function evm_photo(p_code text, p_team int, p_mission text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  return (select photo from evm_submissions where team_id = p_team and mission_id = p_mission);
end $$;

create or replace function evm_cheer(p_code text, p_team int, p_mission text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  update evm_submissions set cheers = cheers + 1 where team_id = p_team and mission_id = p_mission;
end $$;

create or replace function evm_checkin(p_code text, p_team int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  insert into evm_checkins (team_id) values (p_team)
  on conflict (team_id) do update set checked_at = now();
end $$;

-- 본부 알림. 빈 문자열을 보내면 알림을 내린다.
create or replace function evm_notice(p_code text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  insert into evm_notices (body) values (left(coalesce(p_body, ''), 200));
end $$;

-- 참가 팀 수(2~6). 말씀 조각 배분이 달라지므로 행사 시작 전에 정한다.
create or replace function evm_set_teams(p_code text, p_count int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  if p_count not between 2 and 6 then
    raise exception 'EVM_BAD_COUNT' using errcode = 'P0001';
  end if;
  insert into evm_config (key, value) values ('team_count', p_count::text)
  on conflict (key) do update set value = excluded.value;
end $$;

-- 행사 뒤 사진과 기록을 모두 지운다.
create or replace function evm_wipe(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_submissions where true;
  delete from evm_notices where true;
  delete from evm_checkins where true;
end $$;

revoke all on function evm_require(text, boolean) from public, anon, authenticated;
grant execute on function
  evm_login(text), evm_state(text), evm_submit(text, int, text, text), evm_remove(text, int, text),
  evm_photo(text, int, text), evm_cheer(text, int, text), evm_checkin(text, int),
  evm_notice(text, text), evm_wipe(text), evm_set_teams(text, int)
to anon, authenticated;
