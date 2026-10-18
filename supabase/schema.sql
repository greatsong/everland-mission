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

-- 타임어택: 먼저 완료한 순서대로 30·20·10점, 그 뒤는 5점
alter table evm_orders add column if not exists rush boolean not null default false;
alter table evm_orders enable row level security;
-- 팀 위치(선생님 휴대폰이 위치 공유를 켠 동안 보낸 마지막 위치)
create table if not exists evm_locations (
  team_id int primary key check (team_id between 1 and 6),
  lat double precision not null,
  lng double precision not null,
  acc real,
  updated_at timestamptz not null default now()
);
-- 위치 기록(이동 경로). 팀마다 45초에 한 번까지만 쌓는다.
create table if not exists evm_location_log (
  id bigint generated always as identity primary key,
  team_id int not null check (team_id between 0 and 6),
  lat double precision not null,
  lng double precision not null,
  at timestamptz not null default now()
);
create index if not exists evm_location_log_team_at on evm_location_log (team_id, at);
alter table evm_location_log enable row level security;

-- 팀 번호 0은 본부 위치다.
alter table evm_locations drop constraint if exists evm_locations_team_id_check;
alter table evm_locations add constraint evm_locations_team_id_check check (team_id between 0 and 6);
alter table evm_locations enable row level security;
-- 휴대폰 단위 위치(2026-10-11). 한 조가 여러 무리로 나뉘면 선생님 휴대폰마다 따로 기록한다.
-- device: 휴대폰 번호(기기에 저장한 임의 값, 예전 화면은 ''), holder: 그 휴대폰을 가진 선생님
alter table evm_locations add column if not exists device text not null default '';
alter table evm_locations add column if not exists holder text;
alter table evm_location_log add column if not exists device text not null default '';
alter table evm_location_log add column if not exists holder text;
do $$
begin
  -- 기본 키가 팀 번호 하나이면 (팀, 휴대폰)으로 바꾼다.
  if (select array_length(conkey, 1) from pg_constraint
      where conrelid = 'evm_locations'::regclass and conname = 'evm_locations_pkey') = 1 then
    alter table evm_locations drop constraint evm_locations_pkey;
    alter table evm_locations add constraint evm_locations_pkey primary key (team_id, device);
  end if;
end $$;
create index if not exists evm_location_log_team_device_at on evm_location_log (team_id, device, at);
-- 조별 활동(팀이 A조·B조로 나뉨)을 시작한 시각(2026-10-12). 위치가 기록될 때마다 서버가 판단한다.
-- together_at: 다시 모였다고 처음 판단한 시각. 잠깐 모여 보여도 시작 시각이 바뀌지 않도록 5분 동안은 행을 남긴다.
create table if not exists evm_splits (
  team_id int primary key check (team_id between 1 and 6),
  since timestamptz not null default now(),
  together_at timestamptz
);
alter table evm_splits enable row level security;
-- 팀 소개: 담당 선생님 이름과 팀 인증 사진(작은 그림)
create table if not exists evm_teams (
  team_id int primary key check (team_id between 1 and 6),
  teachers text,
  photo text,
  updated_at timestamptz not null default now()
);
alter table evm_teams enable row level security;
alter table evm_scores enable row level security;
-- 처음 올린 시각. 사진을 다시 올려도 바뀌지 않는다(타임어택 순위는 이 시각으로 정한다).
alter table evm_submissions add column if not exists first_at timestamptz not null default now();
-- 사진을 찍은 위치와 지도용 작은 사진(2026-10-12). 앱 안에서 카메라로 찍을 때 휴대폰 위치를 함께 남긴다.
-- 앨범에서 고른 사진은 찍은 곳을 알 수 없어 위치를 남기지 않는다.
alter table evm_submissions add column if not exists lat double precision;
alter table evm_submissions add column if not exists lng double precision;
alter table evm_submissions add column if not exists thumb text;
alter table evm_config enable row level security;
alter table evm_submissions enable row level security;
alter table evm_notices enable row level security;
alter table evm_checkins enable row level security;

-- 코드가 맞으면 'team' 또는 'admin', 틀리면 null.
-- 버스 퀴즈 코드(quiz_code, 2026-10-18)는 본부가 입장을 열어 둔 동안(quiz_open = on) 'player', 닫으면 'ended'.
-- player는 아이들 휴대폰용으로 퀴즈만 보고 답할 수 있다(evm_require_quiz를 쓰는 함수만).
-- 연습(2026-10-18, 교사 연습용): 입장이 닫혀 있고 본부가 연습을 켜면(quiz_practice = on) 'practice'다.
-- practice는 OT와 연습 문제만 보고 evm_practice_answer로 채점만 받는다(아무것도 기록하지 않는다).
create or replace function evm_login(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_code = (select value from evm_config where key = 'admin_code') then 'admin'
    when p_code = (select value from evm_config where key = 'join_code') then 'team'
    when p_code = (select value from evm_config where key = 'quiz_code') then
      case when coalesce((select value from evm_config where key = 'quiz_open'), 'off') = 'on' then 'player'
           when coalesce((select value from evm_config where key = 'quiz_practice'), 'off') = 'on' then 'practice'
           else 'ended' end
  end
$$;

-- 선생님(팀)·본부 코드만 통과한다. 버스 퀴즈 코드(player)는 사진·빙고·위치·팀 소개 함수를 쓸 수 없다.
create or replace function evm_require(p_code text, p_admin boolean default false) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_role text := evm_login(p_code);
begin
  if v_role = 'ended' then
    raise exception 'EVM_QUIZ_ENDED' using errcode = 'P0001';
  end if;
  if v_role is null or v_role in ('player', 'practice') or (p_admin and v_role <> 'admin') then
    raise exception 'EVM_BAD_CODE' using errcode = 'P0001';
  end if;
end $$;

-- 퀴즈 함수(상태 보기·답안·그림)용. 버스 퀴즈 코드도 통과한다. 입장이 닫혔으면 EVM_QUIZ_ENDED.
create or replace function evm_require_quiz(p_code text) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_role text := evm_login(p_code);
begin
  if v_role = 'ended' then
    raise exception 'EVM_QUIZ_ENDED' using errcode = 'P0001';
  end if;
  if v_role is null then
    raise exception 'EVM_BAD_CODE' using errcode = 'P0001';
  end if;
end $$;

-- 버스 퀴즈 입장 열기·닫기(본부). 닫으면 아이들 휴대폰은 다음 갱신 때 "버스 퀴즈가 끝났습니다"로 바뀐다.
create or replace function evm_quiz_entry(p_code text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  insert into evm_config (key, value) values ('quiz_open', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
  -- 버스 진행을 시작하면 연습은 끝난다.
  if p_on then
    insert into evm_config (key, value) values ('quiz_practice', 'off') on conflict (key) do update set value = excluded.value;
  end if;
end $$;

-- 연습 켜기·끄기(본부, 2026-10-18). 켜면 버스 진행(입장)은 닫힌다. 연습 답은 기록하지 않는다.
create or replace function evm_quiz_practice(p_code text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  insert into evm_config (key, value) values ('quiz_practice', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
  if p_on then
    insert into evm_config (key, value) values ('quiz_open', 'off') on conflict (key) do update set value = excluded.value;
  end if;
end $$;

-- 연습 문제 목록과 채점(2026-10-18). OT와 연습 문제를 순서대로 보낸다(정답·설명은 답한 뒤 채점 결과로만 보낸다).
create or replace function evm_practice_quizzes()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'body', body, 'choices', choices, 'hint', hint,
    'round', round, 'has_photo', photo is not null) order by case round when 'ot' then 0 else 1 end, id), '[]'::json)
  from evm_quizzes where round in ('ot', 'practice')
$$;

create or replace function evm_practice_answer(p_code text, p_id bigint, p_text text) returns json
language plpgsql stable security definer set search_path = public as $$
declare q evm_quizzes%rowtype; v_choice boolean; v_ok boolean;
begin
  if evm_login(p_code) not in ('practice', 'admin') then
    raise exception 'EVM_BAD_CODE' using errcode = 'P0001';
  end if;
  select * into q from evm_quizzes where id = p_id and round in ('ot', 'practice');
  if not found then
    raise exception 'EVM_QUIZ_CLOSED' using errcode = 'P0001';
  end if;
  v_choice := (q.kind = 'bible' and q.choices is not null) or q.kind = 'ox';
  v_ok := case when v_choice then upper(btrim(coalesce(p_text, ''))) = upper(q.answer)
    else exists (select 1 from unnest(string_to_array(q.answer, ',')) k
                 where evm_norm(k) <> '' and evm_norm(p_text) = evm_norm(k)) end;
  -- 객관식·OX는 한 번에 끝나므로 정답과 설명을 보낸다. 단답은 맞혔을 때만 정답과 설명을 보낸다.
  return json_build_object('ok', v_ok, 'points', 0, 'each', true,
    'answer', case when v_choice or v_ok then q.answer end,
    'note', case when v_choice or v_ok then q.note end);
end $$;

-- 전체 상태(사진 본문 제외). 화면이 주기적으로 부른다.
-- p_device: 이 휴대폰의 OT 응답(mine)을 함께 돌려준다(버스 퀴즈).
drop function if exists evm_state(text);
create or replace function evm_state(p_code text, p_device text default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := evm_login(p_code); -- 코드 확인은 한 번만 한다
  v_admin boolean := v_role = 'admin';
  -- 버스 퀴즈로 들어온 아이 휴대폰: 버스 문제와 그 점수만 보내고(현장 사진·지령·위치는 보내지 않는다) 응답을 작게 한다.
  v_player boolean := v_role = 'player';
  -- 위치(팀 위치, 사진을 찍은 위치)는 본부에만 보낸다. 본부가 허용하면(share_locations) 팀에게도 보낸다.
  v_see_where boolean := v_admin
    or coalesce((select value from evm_config where key = 'share_locations'), 'off') = 'on';
begin
  perform evm_require_quiz(p_code);
  -- 연습(교사 연습용): 팀 목록과 연습 문제만 보낸다. 점수·입장자·현장 기록은 보내지 않는다.
  if v_role = 'practice' then
    return json_build_object('practice', true, 'now', now(),
      'team_count', coalesce((select value::int from evm_config where key = 'team_count'), 6),
      'teams', coalesce((select json_agg(json_build_object('team_id', team_id, 'teachers', teachers)) from evm_teams), '[]'::json),
      'quizzes', evm_practice_quizzes(), 'scores', '[]'::json, 'players', '[]'::json);
  end if;
  if v_player then
    v_see_where := false;
  end if;
  return json_build_object(
    'submissions', coalesce((
      select json_agg(json_build_object(
        'team_id', team_id, 'mission_id', mission_id, 'cheers', cheers, 'at', created_at, 'first_at', first_at,
        'lat', case when v_see_where then lat end, 'lng', case when v_see_where then lng end
      ) order by created_at desc) from evm_submissions where not v_player), '[]'::json),
    'notice', (select json_build_object('id', id, 'body', body, 'at', created_at)
               from evm_notices order by id desc limit 1),
    'checkins', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'at', checked_at)) from evm_checkins where not v_player), '[]'::json),
    'orders', coalesce((
      select json_agg(json_build_object(
        'id', id, 'kind', kind, 'body', body, 'points', points, 'rush', rush, 'open', open, 'at', created_at,
        'answer', case when v_admin then answer end
      ) order by id desc) from evm_orders where not v_player), '[]'::json),
    -- 배틀 문제는 공개 시각(starts_at) 전에는 문제 내용을 팀에게 보내지 않는다. 그림은 evm_quiz_photo로 따로 받는다.
    'quizzes', coalesce((
      select json_agg(json_build_object(
        'id', id, 'kind', kind, 'points', points, 'status', status, 'author_team', author_team,
        'battle', battle, 'starts_at', starts_at, 'has_photo', photo is not null, 'round', round,
        'body', case when v_admin or starts_at is null or starts_at <= now() then body end,
        'choices', case when v_admin or starts_at is null or starts_at <= now() then choices end,
        'hint', case when v_admin or starts_at is null or starts_at <= now() then hint end,
        'answer', case when v_admin or status = 'closed' then answer end,
        'note', case when v_admin or status = 'closed' then note end
      ) order by id) from evm_quizzes
      where v_admin or (status in ('open', 'closed', 'pending') and (not v_player or round is not null))), '[]'::json),
    'teams', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'teachers', teachers,
        'photo_at', case when photo is not null then updated_at end)) from evm_teams), '[]'::json),
    'scores', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'game_id', game_id, 'score', score, 'ok', ok,
        'who', case when coalesce(ok, score > 0) then who end, 'at', created_at)) from evm_scores
      where not v_player or game_id in (select 'quiz:' || id from evm_quizzes where round is not null)), '[]'::json),
    -- 버스 퀴즈: 들어온 사람(팀·이름), OT 팀별 응답 수와 정답 수, 이 휴대폰의 OT 응답
    -- 입장자 이름은 본부(지우기용 휴대폰 번호 포함)와 같은 팀 아이에게만 보낸다.
    'players', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'name', name, 'device', case when v_admin then device end) order by joined_at)
      from evm_players
      where v_admin or (v_player and team_id = (select team_id from evm_players where device = left(btrim(coalesce(p_device, '')), 40)))), '[]'::json),
    -- 버스 문제 수(아이들 화면의 "OT 3 / 7", 대기실 안내용). 시작 전 문제의 내용은 보내지 않는다.
    'bus_plan', (select json_build_object(
      'ot', count(*) filter (where round = 'ot'), 'ot_draft', count(*) filter (where round = 'ot' and status = 'draft'),
      'bus', count(*) filter (where round = 'bus'), 'bus_draft', count(*) filter (where round = 'bus' and status = 'draft'))
      from evm_quizzes),
    'ot_stats', coalesce((
      select json_agg(json_build_object('quiz_id', quiz_id, 'team_id', team_id, 'answered', n, 'correct', c))
      from (select quiz_id, team_id, count(*) n, count(*) filter (where ok) c from evm_answers group by 1, 2) x
      where v_admin or v_player), '[]'::json),
    'mine', coalesce((
      select json_agg(json_build_object('quiz_id', quiz_id, 'ok', ok)) from evm_answers
      where p_device is not null and device = left(btrim(p_device), 40)), '[]'::json),
    -- 팀 위치는 본부에만 보낸다. 본부가 허용하면(share_locations) 팀에게도 보낸다.
    'share_locations', coalesce((select value from evm_config where key = 'share_locations'), 'off') = 'on',
    'locations', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'device', device, 'holder', holder,
        'lat', lat, 'lng', lng, 'acc', acc, 'at', updated_at))
      from evm_locations
      where v_see_where), '[]'::json),
    'splits', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'since', since)) from evm_splits
      where together_at is null or together_at > now() - interval '5 minutes'), '[]'::json),
    'team_count', coalesce((select value::int from evm_config where key = 'team_count'), 6),
    -- 버스 퀴즈 입장 상태와 코드는 본부에만 보낸다(본부 화면에 표시)
    'quiz_entry', case when v_admin then coalesce((select value from evm_config where key = 'quiz_open'), 'off') = 'on' end,
    'quiz_practice', case when v_admin then coalesce((select value from evm_config where key = 'quiz_practice'), 'off') = 'on' end,
    'quiz_code', case when v_admin then (select value from evm_config where key = 'quiz_code') end,
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
  do update set photo = excluded.photo, cheers = 0, created_at = now(), thumb = null, lat = null, lng = null;
end $$;

-- 사진 올리기(찍은 위치와 지도용 작은 사진 포함). 위치가 없으면 null로 보낸다.
create or replace function evm_submit_at(p_code text, p_team int, p_mission text, p_photo text, p_thumb text,
  p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_submit(p_code, p_team, p_mission, p_photo);
  if p_thumb is not null and (p_thumb not like 'data:image/jpeg;base64,%' or length(p_thumb) > 40000) then
    raise exception 'EVM_BAD_PHOTO' using errcode = 'P0001';
  end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180) then
    raise exception 'EVM_BAD_LOCATION' using errcode = 'P0001';
  end if;
  update evm_submissions set thumb = p_thumb, lat = p_lat, lng = case when p_lat is null then null else p_lng end
  where team_id = p_team and mission_id = p_mission;
end $$;

-- 지도에 띄울 작은 사진
create or replace function evm_thumb(p_code text, p_team int, p_mission text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  return (select thumb from evm_submissions where team_id = p_team and mission_id = p_mission);
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
drop function if exists evm_order(text, text, text, text, int);
create or replace function evm_order(p_code text, p_kind text, p_body text, p_answer text, p_points int, p_rush boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  if p_kind = 'answer' and coalesce(btrim(p_answer), '') = '' then
    raise exception 'EVM_NO_ANSWER' using errcode = 'P0001';
  end if;
  insert into evm_orders (kind, body, answer, points, rush)
  values (p_kind, left(p_body, 200), case when p_kind = 'answer' then btrim(p_answer) end, p_points, coalesce(p_rush, false));
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
  -- 정답 칸에 쉼표로 적은 낱말 중 하나와 맞으면 정답이다(띄어쓰기·대소문자 무시). 예: "판다, 곰"
  v_ok := exists (
    select 1 from unnest(string_to_array(v.answer, ',')) k
    where evm_norm(k) <> '' and evm_norm(p_text) = evm_norm(k)
  );
  if v_ok then
    if v.rush then
      v.points := coalesce((array[30, 20, 10])[1 + (select count(*) from evm_scores where game_id = 'order:' || v.id)::int], 5);
    end if;
    insert into evm_scores (team_id, game_id, score) values (p_team, 'order:' || v.id, v.points)
    on conflict (team_id, game_id) do nothing;
  end if;
  return v_ok;
end $$;

-- 퀴즈. 초성(chosung)·성경(bible)·넌센스(nonsense)·그림(image)·OX(ox)는 본부가 출제하고,
-- 몸으로 말해요(act)는 팀이 사진과 정답을 내면 본부가 승인해 출제한다.
-- status: pending(승인 대기) → draft(보관) → open(출제) → closed(마감)
create table if not exists evm_quizzes (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('chosung', 'bible', 'nonsense', 'act', 'image', 'ox')),
  body text not null,
  choices json,
  answer text not null,
  hint text,
  photo text,
  author_team int check (author_team between 1 and 6),
  points int not null default 10 check (points between 1 and 30),
  status text not null default 'draft' check (status in ('pending', 'draft', 'open', 'closed')),
  created_at timestamptz not null default now()
);
alter table evm_quizzes enable row level security;
-- 그림 퀴즈와 퀴즈 배틀(2026-10-17). 그림 퀴즈는 photo 칸(몸으로 말해요와 같은 칸)에 그림을 둔다.
alter table evm_quizzes drop constraint if exists evm_quizzes_kind_check;
alter table evm_quizzes add constraint evm_quizzes_kind_check check (kind in ('chosung', 'bible', 'nonsense', 'act', 'image', 'ox'));
-- OX 퀴즈(2026-10-18, 버스 OT): 정답은 'O' 또는 'X'이고 객관식처럼 팀에서 한 번만 답한다.
-- note: 답한 뒤에 보여 주는 설명(OT 규칙 안내 등). 답한 팀에는 채점 결과와 함께, 모든 팀에는 마감 뒤에 보낸다.
alter table evm_quizzes add column if not exists note text;
-- 버스 퀴즈(2026-10-18): round가 'ot'이면 OT(아이마다 한 번씩 답하고 점수 없음), 'bus'면 팀 대항(작은 점수 6·4·2·1).
-- null이면 에버랜드 현장 퀴즈다. 버스 문제는 본부 진행판에서 한 문제씩 시작한다(evm_bus_start).
alter table evm_quizzes add column if not exists round text check (round in ('ot', 'bus'));
-- 연습 문제(2026-10-18): round가 'practice'면 연습 모드에서만 보이는 문제다(버스 진행에는 나오지 않는다).
alter table evm_quizzes drop constraint if exists evm_quizzes_round_check;
alter table evm_quizzes add constraint evm_quizzes_round_check check (round in ('ot', 'bus', 'practice'));
-- 맞힌 사람 이름(버스 퀴즈). 팀 기록을 만든 사람이며, 화면에는 맞힌 사람만 보인다.
alter table evm_scores add column if not exists who text;
-- 버스 퀴즈에 들어온 사람(휴대폰마다 한 줄). 이름은 행사 뒤 evm_wipe로 지운다.
create table if not exists evm_players (
  device text primary key,
  team_id int not null check (team_id between 1 and 6),
  name text not null,
  joined_at timestamptz not null default now()
);
alter table evm_players enable row level security;
-- OT 개인 응답. 휴대폰마다 한 번 답하고 점수는 없다. 팀별 정답률을 보여 준다.
create table if not exists evm_answers (
  quiz_id bigint not null references evm_quizzes(id) on delete cascade,
  device text not null,
  team_id int not null check (team_id between 1 and 6),
  name text,
  ok boolean not null,
  created_at timestamptz not null default now(),
  primary key (quiz_id, device)
);
alter table evm_answers enable row level security;
-- battle: 선착순 방식. rush는 맞힌 순서대로 30·20·10점, 그 뒤 5점. first는 1등 팀만 문제 점수를 받는다. null이면 보통 문제
alter table evm_quizzes add column if not exists battle text check (battle in ('rush', 'first'));
-- starts_at: 배틀 문제를 공개하는 시각. 본부가 배틀을 시작하면 10초나 15초 뒤로 정한다
alter table evm_quizzes add column if not exists starts_at timestamptz;
-- 점수 기록의 정답 여부. 1등만 받는 배틀에서 늦게 맞힌 팀은 0점이지만 정답으로 남긴다(null인 예전 기록은 점수가 있으면 정답)
alter table evm_scores add column if not exists ok boolean;

create or replace function evm_norm(p_text text) returns text
language sql immutable as $$
  select regexp_replace(lower(coalesce(p_text, '')), '\s', '', 'g')
$$;

-- 문제 출제(본부). 만든 문제 번호를 돌려준다. 그림 퀴즈는 그림(긴 변 1024px JPEG)이 있어야 한다.
-- 배틀 문제는 보관 상태로 넣고, evm_quiz_battle_start로 카운트다운을 시작한다. p_note는 답한 뒤에 보여 주는 설명이다.
drop function if exists evm_quiz_add(text, text, text, json, text, text, int, boolean);
drop function if exists evm_quiz_add(text, text, text, json, text, text, int, boolean, text, text);
drop function if exists evm_quiz_add(text, text, text, json, text, text, int, boolean, text, text, text);
-- p_round: 'ot'(OT, 점수 없음)·'bus'(팀 대항)·null(현장). 버스 문제는 보관 상태로 넣고 진행판에서 시작한다.
create or replace function evm_quiz_add(
  p_code text, p_kind text, p_body text, p_choices json, p_answer text, p_hint text, p_points int, p_open boolean,
  p_photo text default null, p_battle text default null, p_note text default null, p_round text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform evm_require(p_code, true);
  if p_kind = 'act' or coalesce(btrim(p_answer), '') = '' or coalesce(btrim(p_body), '') = '' then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  if p_kind = 'image' and (p_photo is null or p_photo not like 'data:image/jpeg;base64,%' or length(p_photo) > 700000) then
    raise exception 'EVM_BAD_PHOTO' using errcode = 'P0001';
  end if;
  if p_kind = 'ox' and upper(btrim(p_answer)) not in ('O', 'X') then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  insert into evm_quizzes (kind, body, choices, answer, hint, points, status, photo, battle, note, round)
  values (p_kind, left(btrim(p_body), 300), p_choices,
          case when p_kind = 'ox' then upper(btrim(p_answer)) else btrim(p_answer) end,
          nullif(btrim(coalesce(p_hint, '')), ''), case when p_round = 'bus' then least(greatest(p_points, 1), 6) else p_points end,
          case when p_open and p_battle is null and p_round is null then 'open' else 'draft' end,
          case when p_kind = 'image' then p_photo end,
          case when p_round in ('ot', 'practice') then null when p_round = 'bus' then 'rush' else p_battle end, -- 팀 대항은 선착순만
          nullif(left(btrim(coalesce(p_note, '')), 400), ''), p_round)
  returning id into v_id;
  return v_id;
end $$;

-- 버스 문제 시작(본부 진행판). 열려 있는 다른 버스 문제(OT·팀 대항)는 마감하고 이 문제를 p_seconds초 뒤에 공개한다.
-- 아이들 화면은 지금 열린 버스 문제 하나만 보여 준다.
create or replace function evm_bus_start(p_code text, p_id bigint, p_seconds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  if p_seconds not between 0 and 60 then
    raise exception 'EVM_BAD_SECONDS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from evm_quizzes where id = p_id and round in ('ot', 'bus')) then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  update evm_quizzes set status = 'closed' where round is not null and status = 'open' and id <> p_id;
  update evm_quizzes set status = 'open', starts_at = now() + make_interval(secs => p_seconds) where id = p_id;
end $$;

-- 버스 퀴즈 입장(아이들·선생님 휴대폰). 이름은 1~10자. 같은 휴대폰이 다시 들어오면 팀·이름을 바꾼다.
create or replace function evm_player_join(p_code text, p_device text, p_team int, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require_quiz(p_code);
  if evm_login(p_code) = 'practice' then
    return; -- 연습은 입장 기록을 남기지 않는다(교사 연습용)
  end if;
  if coalesce(btrim(p_device), '') = '' or length(btrim(coalesce(p_name, ''))) not between 1 and 10 or p_team not between 1 and 6 then
    raise exception 'EVM_BAD_PLAYER' using errcode = 'P0001';
  end if;
  -- 팀 대항이 시작된 뒤에는 다른 팀으로 바꿀 수 없다(다른 팀 문제에 일부러 틀리는 일을 막는다).
  if exists (select 1 from evm_players where device = left(btrim(p_device), 40) and team_id <> p_team)
     and exists (select 1 from evm_quizzes where round = 'bus' and status <> 'draft') then
    raise exception 'EVM_TEAM_LOCKED' using errcode = 'P0001';
  end if;
  if (select count(*) from evm_players) >= 300 and not exists (select 1 from evm_players where device = left(btrim(p_device), 40)) then
    raise exception 'EVM_FULL' using errcode = 'P0001';
  end if;
  insert into evm_players (device, team_id, name) values (left(btrim(p_device), 40), p_team, btrim(p_name))
  on conflict (device) do update set team_id = excluded.team_id, name = excluded.name;
end $$;

-- 문제 고치기(본부, 2026-10-18). 문장·정답·힌트·설명(객관식은 선택지)을 바로 고친다. 그림·점수·배틀 방식·상태는 그대로다.
-- 이미 받은 답은 다시 채점하지 않는다(화면이 미리 알린다).
create or replace function evm_quiz_edit(p_code text, p_id bigint, p_body text, p_answer text, p_hint text, p_note text,
  p_choices json default null) returns void
language plpgsql security definer set search_path = public as $$
declare q evm_quizzes%rowtype;
begin
  perform evm_require(p_code, true);
  select * into q from evm_quizzes where id = p_id;
  if not found or coalesce(btrim(p_body), '') = '' or coalesce(btrim(p_answer), '') = '' then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  if q.kind = 'ox' and upper(btrim(p_answer)) not in ('O', 'X') then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  update evm_quizzes set
    body = left(btrim(p_body), 300),
    answer = case when q.kind = 'ox' then upper(btrim(p_answer)) else btrim(p_answer) end,
    hint = nullif(btrim(coalesce(p_hint, '')), ''),
    note = nullif(left(btrim(coalesce(p_note, '')), 400), ''),
    choices = case when q.choices is not null and p_choices is not null then p_choices else q.choices end
  where id = p_id;
end $$;

-- 버스 퀴즈 처음부터 다시(본부, 리허설용). 버스 문제를 시작 전으로 되돌리고 OT 응답과 버스 점수만 지운다.
-- 입장자(아이들 이름·팀)와 현장 기록(사진·지령·현장 퀴즈 점수)은 그대로 둔다.
create or replace function evm_bus_reset(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_answers where true;
  delete from evm_scores where game_id in (select 'quiz:' || id from evm_quizzes where round is not null);
  update evm_quizzes set status = 'draft', starts_at = null where round is not null;
end $$;

-- 입장자 한 명 내보내기(본부, 부적절한 이름 등). 그 휴대폰은 다시 입장해야 답할 수 있다.
create or replace function evm_player_remove(p_code text, p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_players where device = p_device;
end $$;

-- 버스 퀴즈가 끝난 뒤 아이들 이름 지우기(본부). 입장자 목록과 맞힌 사람 이름을 지우고 점수는 남긴다.
create or replace function evm_bus_forget(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_players where true;
  update evm_scores set who = null where who is not null;
end $$;

-- 배틀 시작(본부). 열려 있는 다른 배틀 문제는 마감하고, p_seconds초 뒤에 이 문제를 공개한다.
-- 공개 전에는 팀에게 문제 내용과 그림을 보내지 않고 답도 받지 않는다(evm_state, evm_quiz_photo, evm_quiz_answer).
create or replace function evm_quiz_battle_start(p_code text, p_id bigint, p_seconds int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  if p_seconds not between 0 and 60 then
    raise exception 'EVM_BAD_SECONDS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from evm_quizzes where id = p_id and battle is not null) then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  update evm_quizzes set status = 'closed' where battle is not null and status = 'open' and id <> p_id and round is null;
  update evm_quizzes set status = 'open', starts_at = now() + make_interval(secs => p_seconds) where id = p_id;
end $$;

-- 기본 문제 묶음을 보관 상태로 넣는다. p_items: [{kind, body, choices, answer, hint}]
create or replace function evm_quiz_seed(p_code text, p_items json) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  insert into evm_quizzes (kind, body, choices, answer, hint, status)
  select e->>'kind', e->>'body', e->'choices', e->>'answer', e->>'hint', 'draft'
  from json_array_elements(p_items) e
  where e->>'kind' in ('chosung', 'bible', 'nonsense');
end $$;

create or replace function evm_quiz_set(p_code text, p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  update evm_quizzes set status = p_status where id = p_id;
end $$;

-- 보관 중인 문제를 한꺼번에 출제한다.
create or replace function evm_quiz_open_all(p_code text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  update evm_quizzes set status = 'open' where kind = p_kind and status = 'draft' and battle is null and round is null;
end $$;

create or replace function evm_quiz_delete(p_code text, p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_scores where game_id = 'quiz:' || p_id or game_id like 'qa:' || p_id || ':%';
  delete from evm_quizzes where id = p_id;
end $$;

-- 몸으로 말해요 출제(팀). 팀당 하나만 낼 수 있고 본부 승인 뒤에 출제된다.
create or replace function evm_act_submit(p_code text, p_team int, p_photo text, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  if p_photo not like 'data:image/jpeg;base64,%' or length(p_photo) > 400000 then
    raise exception 'EVM_BAD_PHOTO' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_answer), '') = '' then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  if exists (select 1 from evm_quizzes where kind = 'act' and author_team = p_team) then
    raise exception 'EVM_ACT_EXISTS' using errcode = 'P0001';
  end if;
  insert into evm_quizzes (kind, body, answer, photo, author_team, status)
  values ('act', '사진 속 팀이 몸으로 표현한 것은 무엇입니까?', left(btrim(p_answer), 40), p_photo, p_team, 'pending');
end $$;

-- 퀴즈 그림. 배틀 문제는 카운트다운 동안 미리 받아 두고 공개 시각에 보여 준다(버스 통신이 느려도 팀마다 그림이 늦게 뜨지 않게).
-- 문제 내용(body)은 공개 시각 전에는 보내지 않는다(evm_state).
create or replace function evm_quiz_photo(p_code text, p_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require_quiz(p_code);
  return (select photo from evm_quizzes
          where id = p_id and (evm_login(p_code) = 'admin'
            or (evm_login(p_code) = 'practice' and round in ('ot', 'practice'))
            or (evm_login(p_code) <> 'practice' and status in ('open', 'closed'))));
end $$;

-- 답안 제출과 채점. 객관식은 한 번만, 나머지는 맞힐 때까지 낼 수 있다.
-- 초성 퀴즈는 힌트를 보면 절반 점수(그림 퀴즈의 힌트는 감점이 없다). 몸으로 말해요는 맞힌 팀마다 출제 팀도 절반 점수를 받는다.
-- 배틀 문제는 맞힌 순서(서버가 답을 받은 순서)로 점수를 정한다. rush는 30·20·10점, 그 뒤 5점. first는 1등만 문제 점수.
-- 버스 퀴즈(2026-10-18): OT(round = 'ot')는 휴대폰마다 따로 답하고(evm_answers) 점수가 없다.
-- 팀 대항(round = 'bus') 선착순은 6·4·2점, 그 뒤 1점(현장 배틀의 1/5). p_name은 맞힌 사람 이름으로 남는다.
drop function if exists evm_quiz_answer(text, int, bigint, text, boolean);
create or replace function evm_quiz_answer(p_code text, p_team int, p_id bigint, p_text text, p_hint boolean,
  p_name text default null, p_device text default null) returns json
language plpgsql security definer set search_path = public as $$
declare q evm_quizzes%rowtype; v_ok boolean; v_choice boolean; v_points int := 0; v_rank int;
  v_device text := left(btrim(coalesce(p_device, '')), 40);
  v_player boolean := evm_login(p_code) = 'player';
begin
  perform evm_require_quiz(p_code);
  if evm_login(p_code) = 'practice' then
    raise exception 'EVM_QUIZ_PRACTICE' using errcode = 'P0001'; -- 연습 답은 evm_practice_answer로 채점만 한다
  end if;
  -- 버스 퀴즈 코드(아이 휴대폰)는 입장할 때 고른 팀·이름으로만 답한다(다른 팀·이름 사칭 방지).
  if v_player then
    select team_id, name into p_team, p_name from evm_players where device = v_device;
    if not found then
      raise exception 'EVM_BAD_PLAYER' using errcode = 'P0001';
    end if;
  end if;
  -- 문제 행을 잠가 같은 문제의 답안을 하나씩 처리한다(배틀 순위가 겹치지 않게).
  select * into q from evm_quizzes where id = p_id and status = 'open' for update;
  if not found then
    raise exception 'EVM_QUIZ_CLOSED' using errcode = 'P0001';
  end if;
  if q.starts_at > now() then
    raise exception 'EVM_QUIZ_NOT_STARTED' using errcode = 'P0001';
  end if;
  if v_player and q.round is null then
    raise exception 'EVM_BAD_CODE' using errcode = 'P0001'; -- 버스 퀴즈 코드로는 현장 퀴즈에 답할 수 없다
  end if;
  v_choice := (q.kind = 'bible' and q.choices is not null) or q.kind = 'ox';
  -- OT: 휴대폰마다 한 번(객관식·OX) 또는 맞힐 때까지(단답) 답한다. 점수는 없다.
  if q.round = 'ot' then
    if v_device = '' then
      raise exception 'EVM_BAD_PLAYER' using errcode = 'P0001';
    end if;
    if exists (select 1 from evm_answers where quiz_id = q.id and device = v_device) then
      raise exception 'EVM_QUIZ_DONE' using errcode = 'P0001';
    end if;
    v_ok := case when v_choice then upper(btrim(coalesce(p_text, ''))) = upper(q.answer)
      else exists (select 1 from unnest(string_to_array(q.answer, ',')) k
                   where evm_norm(k) <> '' and evm_norm(p_text) = evm_norm(k)) end;
    if v_ok or v_choice then
      -- OT 응답에는 이름을 남기지 않는다(팀별 정답 수만 쓴다).
      insert into evm_answers (quiz_id, device, team_id, name, ok)
      values (q.id, v_device, p_team, null, v_ok)
      on conflict (quiz_id, device) do nothing;
    end if;
    return json_build_object('ok', v_ok, 'points', 0, 'each', true,
      'answer', case when v_choice then q.answer end, 'note', q.note);
  end if;
  if q.author_team = p_team then
    raise exception 'EVM_OWN_QUIZ' using errcode = 'P0001';
  end if;
  if exists (select 1 from evm_scores where team_id = p_team and game_id = 'quiz:' || q.id) then
    raise exception 'EVM_QUIZ_DONE' using errcode = 'P0001';
  end if;
  -- 객관식(성경 퀴즈에 선택지가 있을 때)은 번호를 비교한다.
  -- 그 밖에는 정답 칸에 쉼표로 적은 낱말 중 하나와 맞으면 정답이다.
  -- 성경 단답형은 답안에 핵심 낱말이 들어 있으면 정답으로 본다(예: 정답 "모세", 답안 "모세입니다").
  -- OX 퀴즈도 객관식처럼 한 번만 답한다('O' 또는 'X'). v_choice는 위에서 정했다.
  if v_choice then
    v_ok := upper(btrim(coalesce(p_text, ''))) = upper(q.answer);
  else
    v_ok := exists (
      select 1 from unnest(string_to_array(q.answer, ',')) k
      where evm_norm(k) <> ''
        and case when q.kind = 'bible' then evm_norm(p_text) like '%' || evm_norm(k) || '%'
                 else evm_norm(p_text) = evm_norm(k) end
    );
  end if;
  if v_ok then
    if q.battle is not null then
      v_rank := 1 + (select count(*) from evm_scores where game_id = 'quiz:' || q.id and coalesce(ok, score > 0));
      v_points := case
        when q.battle = 'first' then case when v_rank = 1 then q.points else 0 end
        when q.round = 'bus' then case v_rank when 1 then 6 when 2 then 4 when 3 then 2 else 1 end
        else case v_rank when 1 then 30 when 2 then 20 when 3 then 10 else 5 end
      end;
    else
      v_points := q.points;
    end if;
    if q.kind = 'chosung' and p_hint then
      v_points := (v_points + 1) / 2;
    end if;
  end if;
  -- 기록 시각은 잠금을 얻은 뒤의 실제 시각(clock_timestamp)으로 남겨, 화면의 맞힌 순서가 순위와 같게 한다.
  if v_ok or v_choice then
    insert into evm_scores (team_id, game_id, score, ok, created_at, who)
    values (p_team, 'quiz:' || q.id, v_points, v_ok, clock_timestamp(), nullif(left(btrim(coalesce(p_name, '')), 10), ''))
    on conflict (team_id, game_id) do nothing;
  end if;
  if v_ok and q.author_team is not null then
    insert into evm_scores (team_id, game_id, score) values (q.author_team, 'qa:' || q.id || ':' || p_team, (q.points + 1) / 2)
    on conflict (team_id, game_id) do nothing;
  end if;
  -- first_team: 1등만 배틀에서 늦게 맞혔을 때 가장 먼저 맞힌 팀(화면이 아직 갱신 전이어도 1등 팀을 알린다)
  return json_build_object('ok', v_ok, 'points', v_points, 'rank', v_rank,
    'first_team', case when q.battle = 'first' and v_rank > 1 then (
      select team_id from evm_scores where game_id = 'quiz:' || q.id and coalesce(ok, score > 0) order by created_at limit 1) end,
    'answer', case when v_choice then q.answer end,
    'note', q.note);
end $$;

drop function if exists evm_score(text, int, text, int);

-- 팀의 휴대폰들이 서로 떨어져 있는지(둘 이상의 조로 나뉘었는지). 화면의 locationGroups(logic.js)와 같은 규칙이다.
-- 같은 팀의 가장 최근 위치보다 60분 넘게 오래된 휴대폰은 뺀다. 두 휴대폰 사이 거리가 20m(또는 두 오차의 합)보다 멀면
-- 떨어졌다고 보고, 두 휴대폰이 모두 위치를 보내는 중(기록 시각 차이 4분 이내)이면 그 차이 동안 함께 걸었을 수 있는
-- 거리(초속 1m)를 기준에 더한다. 첫 휴대폰에서 가까운 휴대폰을 따라가 모두 닿으면 한 무리다.
create or replace function evm_team_apart(p_team int) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_lat double precision[] := '{}';
  v_lng double precision[] := '{}';
  v_acc double precision[] := '{}';
  v_at timestamptz[] := '{}';
  v_seen boolean[];
  v_queue int[];
  v_n int;
  i int;
  j int;
  v_gap double precision;
  v_walk double precision;
  v_x double precision;
  v_y double precision;
begin
  for r in
    select lat, lng, acc, updated_at from evm_locations
    where team_id = p_team
      and updated_at >= (select max(updated_at) from evm_locations where team_id = p_team) - interval '60 minutes'
  loop
    v_lat := v_lat || r.lat;
    v_lng := v_lng || r.lng;
    v_acc := v_acc || coalesce(r.acc, 0)::double precision;
    v_at := v_at || r.updated_at;
  end loop;
  v_n := coalesce(array_length(v_lat, 1), 0);
  if v_n < 2 then
    return false;
  end if;
  v_seen := array_fill(false, array[v_n]);
  v_seen[1] := true;
  v_queue := array[1];
  while coalesce(array_length(v_queue, 1), 0) > 0 loop
    i := v_queue[1];
    v_queue := v_queue[2:];
    for j in 1..v_n loop
      continue when v_seen[j];
      v_gap := abs(extract(epoch from v_at[i] - v_at[j]));
      v_walk := case when v_gap <= 240 then greatest(0, v_gap - 20) else 0 end;
      v_x := radians(v_lng[j] - v_lng[i]) * cos(radians((v_lat[i] + v_lat[j]) / 2));
      v_y := radians(v_lat[j] - v_lat[i]);
      if round(sqrt(v_x * v_x + v_y * v_y) * 6371000) <= greatest(20, v_acc[i] + v_acc[j]) + v_walk then
        v_seen[j] := true;
        v_queue := v_queue || j;
      end if;
    end loop;
  end loop;
  return not (true = all(v_seen));
end $$;

-- 조별 활동 기록을 갱신한다. 떨어져 있으면 시작 시각을 남기고(이미 있으면 그대로 둔다), 모여 있으면 5분 뒤에 지운다.
create or replace function evm_split_update(p_team int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_team = 0 then
    return;
  end if;
  if evm_team_apart(p_team) then
    insert into evm_splits (team_id) values (p_team)
    on conflict (team_id) do update set together_at = null;
  else
    update evm_splits set together_at = coalesce(together_at, now()) where team_id = p_team;
    delete from evm_splits where team_id = p_team and together_at < now() - interval '5 minutes';
  end if;
end $$;

-- 위치 기록(휴대폰 단위). 이동 경로는 휴대폰마다 45초에 한 번까지만 쌓는다.
create or replace function evm_locate_phone(p_code text, p_team int, p_device text, p_holder text,
  p_lat double precision, p_lng double precision, p_acc real) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_device text := left(coalesce(p_device, ''), 40);
  v_holder text := nullif(left(btrim(coalesce(p_holder, '')), 20), '');
begin
  perform evm_require(p_code, p_team = 0);
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'EVM_BAD_LOCATION' using errcode = 'P0001';
  end if;
  insert into evm_locations (team_id, device, holder, lat, lng, acc) values (p_team, v_device, v_holder, p_lat, p_lng, p_acc)
  on conflict (team_id, device) do update
    set holder = excluded.holder, lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, updated_at = now();
  if not exists (select 1 from evm_location_log
                 where team_id = p_team and device = v_device and at > now() - interval '45 seconds') then
    insert into evm_location_log (team_id, device, holder, lat, lng) values (p_team, v_device, v_holder, p_lat, p_lng);
  end if;
  perform evm_split_update(p_team);
end $$;

-- 예전 화면이 부르는 위치 기록. 휴대폰 번호 없이('') 기록한다.
create or replace function evm_locate(p_code text, p_team int, p_lat double precision, p_lng double precision, p_acc real) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_locate_phone(p_code, p_team, '', null, p_lat, p_lng, p_acc);
end $$;

-- 위치 공유를 끈 휴대폰의 마지막 위치를 지운다. 이동 경로는 남긴다.
create or replace function evm_locate_off(p_code text, p_team int, p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, p_team = 0);
  delete from evm_locations where team_id = p_team and device = coalesce(p_device, '');
  perform evm_split_update(p_team);
end $$;

-- 이동 경로(본부 전용). 시간 순서로 돌려준다.
create or replace function evm_tracks(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  return coalesce((
    select json_agg(json_build_object('team_id', team_id, 'device', device, 'holder', holder,
      'lat', lat, 'lng', lng, 'at', at) order by at)
    from evm_location_log), '[]'::json);
end $$;

-- 팀끼리 서로의 위치를 볼 수 있게 할지(본부).
create or replace function evm_share_locations(p_code text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  insert into evm_config (key, value) values ('share_locations', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
end $$;

-- 팀 소개 저장. 사진을 보내지 않으면(null) 기존 사진을 유지한다.
create or replace function evm_team_set(p_code text, p_team int, p_teachers text, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  if p_photo is not null and (p_photo not like 'data:image/jpeg;base64,%' or length(p_photo) > 60000) then
    raise exception 'EVM_BAD_PHOTO' using errcode = 'P0001';
  end if;
  insert into evm_teams (team_id, teachers, photo) values (p_team, left(btrim(coalesce(p_teachers, '')), 40), p_photo)
  on conflict (team_id) do update
    set teachers = excluded.teachers, photo = coalesce(excluded.photo, evm_teams.photo), updated_at = now();
end $$;

create or replace function evm_team_photo(p_code text, p_team int) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  return (select photo from evm_teams where team_id = p_team);
end $$;

-- 점검 기록: 기기가 보내는 접속·오류 보고. 시험과 행사 중 문제를 추적하는 데 사용한다.
create table if not exists evm_events (
  id bigint generated always as identity primary key,
  team_id int,
  kind text not null,
  message text,
  ua text,
  created_at timestamptz not null default now()
);
alter table evm_events enable row level security;

-- 입장 전 오류도 받아야 하므로 코드를 확인하지 않는다. 길이를 자르고 3,000건까지만 보관한다.
create or replace function evm_report(p_team int, p_kind text, p_message text, p_ua text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into evm_events (team_id, kind, message, ua)
  values (p_team, left(coalesce(p_kind, '?'), 20), left(p_message, 300), left(p_ua, 250));
  delete from evm_events where id <= (select max(id) from evm_events) - 3000;
end $$;

create or replace function evm_events_list(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  return coalesce((
    select json_agg(e order by e.id desc) from (
      select id, team_id, kind, message, ua, created_at as at from evm_events order by id desc limit 300
    ) e), '[]'::json);
end $$;

create or replace function evm_events_clear(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_events where true;
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

-- 사진과 기록을 모두 지운다. 본부가 출제한 퀴즈 문제와 팀 소개의 담당 선생님 이름은 남는다.
create or replace function evm_wipe(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  delete from evm_submissions where true;
  delete from evm_notices where true;
  delete from evm_checkins where true;
  delete from evm_scores where true;
  delete from evm_orders where true;
  delete from evm_locations where true;
  update evm_teams set photo = null, updated_at = now() where true;
  delete from evm_location_log where true;
  delete from evm_splits where true;
  -- 팀이 낸 몸으로 말해요 문제는 지우고, 본부가 출제한 문제는 남긴다.
  delete from evm_quizzes where kind = 'act';
  -- 버스 퀴즈에 들어온 아이들 이름과 OT 응답도 지우고, 버스 문제는 시작 전 상태로 되돌린다(리허설 뒤 처음부터).
  delete from evm_answers where true;
  delete from evm_players where true;
  update evm_quizzes set status = 'draft', starts_at = null where round is not null;
end $$;

revoke all on function evm_require(text, boolean), evm_require_quiz(text) from public, anon, authenticated;
revoke all on function evm_team_apart(int), evm_split_update(int) from public, anon, authenticated;
revoke all on function evm_practice_quizzes() from public, anon, authenticated; -- evm_state(연습)가 안에서만 부른다
grant execute on function
  evm_login(text), evm_state(text, text), evm_submit(text, int, text, text), evm_remove(text, int, text),
  evm_submit_at(text, int, text, text, text, double precision, double precision), evm_thumb(text, int, text),
  evm_photo(text, int, text), evm_cheer(text, int, text), evm_checkin(text, int),
  evm_notice(text, text), evm_wipe(text), evm_set_teams(text, int),
  evm_locate(text, int, double precision, double precision, real),
  evm_locate_phone(text, int, text, text, double precision, double precision, real), evm_locate_off(text, int, text),
  evm_share_locations(text, boolean), evm_tracks(text),
  evm_team_set(text, int, text, text), evm_team_photo(text, int),
  evm_report(int, text, text, text), evm_events_list(text), evm_events_clear(text),
  evm_quiz_add(text, text, text, json, text, text, int, boolean, text, text, text, text), evm_quiz_battle_start(text, bigint, int),
  evm_bus_start(text, bigint, int), evm_player_join(text, text, int, text), evm_player_remove(text, text), evm_bus_forget(text),
  evm_quiz_edit(text, bigint, text, text, text, text, json), evm_bus_reset(text),
  evm_quiz_practice(text, boolean), evm_practice_answer(text, bigint, text),
  evm_quiz_entry(text, boolean),
  evm_quiz_seed(text, json), evm_quiz_set(text, bigint, text),
  evm_quiz_open_all(text, text), evm_quiz_delete(text, bigint), evm_act_submit(text, int, text, text),
  evm_quiz_photo(text, bigint), evm_quiz_answer(text, int, bigint, text, boolean, text, text),
  evm_order(text, text, text, text, int, boolean), evm_order_close(text, bigint), evm_answer(text, int, bigint, text)
to anon, authenticated;
