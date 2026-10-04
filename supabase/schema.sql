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

-- 전체 대결 게임 점수. 팀당 게임마다 한 번만 기록된다.
create table if not exists evm_scores (
  team_id int not null check (team_id between 1 and 6),
  game_id text not null check (length(game_id) <= 20),
  score int not null check (score between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (team_id, game_id)
);

-- 본부 지령. 사진 미션(photo)은 사진을 올리면, 정답 미션(answer)은 정답을 맞히면 점수를 받는다.
create table if not exists evm_orders (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('photo', 'answer')),
  body text not null,
  answer text,
  points int not null default 20 check (points between 0 and 50),
  open boolean not null default true,
  created_at timestamptz not null default now()
);

alter table evm_orders enable row level security;
alter table evm_scores enable row level security;
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
    'orders', coalesce((
      select json_agg(json_build_object(
        'id', id, 'kind', kind, 'body', body, 'points', points, 'open', open, 'at', created_at,
        'answer', case when evm_login(p_code) = 'admin' then answer end
      ) order by id desc) from evm_orders), '[]'::json),
    'scores', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'game_id', game_id, 'score', score)) from evm_scores), '[]'::json),
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
  if p_mission like 'order:%' and not exists (
    select 1 from evm_orders where 'order:' || id = p_mission and kind = 'photo' and open
  ) then
    raise exception 'EVM_ORDER_CLOSED' using errcode = 'P0001';
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

-- 지령 추가(본부). 정답 미션은 p_answer에 정답 낱말을 넣는다.
create or replace function evm_order(p_code text, p_kind text, p_body text, p_answer text, p_points int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  if p_kind = 'answer' and coalesce(btrim(p_answer), '') = '' then
    raise exception 'EVM_NO_ANSWER' using errcode = 'P0001';
  end if;
  insert into evm_orders (kind, body, answer, points)
  values (p_kind, left(p_body, 200), case when p_kind = 'answer' then btrim(p_answer) end, p_points);
end $$;

create or replace function evm_order_close(p_code text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  update evm_orders set open = false where id = p_id;
end $$;

-- 정답 미션 답안 제출. 띄어쓰기와 대소문자는 무시하고 비교한다. 맞으면 점수를 한 번만 기록한다.
create or replace function evm_answer(p_code text, p_team int, p_order bigint, p_text text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v evm_orders%rowtype; v_ok boolean;
begin
  perform evm_require(p_code);
  select * into v from evm_orders where id = p_order and kind = 'answer' and open;
  if not found then
    raise exception 'EVM_ORDER_CLOSED' using errcode = 'P0001';
  end if;
  v_ok := regexp_replace(lower(coalesce(p_text, '')), '\s', '', 'g') = regexp_replace(lower(v.answer), '\s', '', 'g');
  if v_ok then
    insert into evm_scores (team_id, game_id, score) values (p_team, 'order:' || v.id, v.points)
    on conflict (team_id, game_id) do nothing;
  end if;
  return v_ok;
end $$;

-- 대결 점수 기록. 이미 기록이 있으면 바꾸지 않는다(다시 풀어도 처음 점수가 남는다).
create or replace function evm_score(p_code text, p_team int, p_game text, p_score int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  if p_game not in ('bible', 'chosung') then
    raise exception 'EVM_BAD_GAME' using errcode = 'P0001';
  end if;
  insert into evm_scores (team_id, game_id, score) values (p_team, p_game, p_score)
  on conflict (team_id, game_id) do nothing;
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
  delete from evm_scores where true;
  delete from evm_orders where true;
end $$;

revoke all on function evm_require(text, boolean) from public, anon, authenticated;
grant execute on function
  evm_login(text), evm_state(text), evm_submit(text, int, text, text), evm_remove(text, int, text),
  evm_photo(text, int, text), evm_cheer(text, int, text), evm_checkin(text, int),
  evm_notice(text, text), evm_wipe(text), evm_set_teams(text, int), evm_score(text, int, text, int),
  evm_order(text, text, text, text, int), evm_order_close(text, bigint), evm_answer(text, int, bigint, text)
to anon, authenticated;
