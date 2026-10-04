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
-- 팀 번호 0은 본부 위치다.
alter table evm_locations drop constraint if exists evm_locations_team_id_check;
alter table evm_locations add constraint evm_locations_team_id_check check (team_id between 0 and 6);
alter table evm_locations enable row level security;
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
        'id', id, 'kind', kind, 'body', body, 'points', points, 'rush', rush, 'open', open, 'at', created_at,
        'answer', case when evm_login(p_code) = 'admin' then answer end
      ) order by id desc) from evm_orders), '[]'::json),
    'quizzes', coalesce((
      select json_agg(json_build_object(
        'id', id, 'kind', kind, 'body', body, 'choices', choices, 'hint', hint, 'points', points,
        'status', status, 'author_team', author_team,
        'answer', case when evm_login(p_code) = 'admin' or status = 'closed' then answer end
      ) order by id) from evm_quizzes
      where evm_login(p_code) = 'admin' or status in ('open', 'closed', 'pending')), '[]'::json),
    'scores', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'game_id', game_id, 'score', score)) from evm_scores), '[]'::json),
    -- 팀 위치는 본부에만 보낸다. 본부가 허용하면(share_locations) 팀에게도 보낸다.
    'share_locations', coalesce((select value from evm_config where key = 'share_locations'), 'off') = 'on',
    'locations', coalesce((
      select json_agg(json_build_object('team_id', team_id, 'lat', lat, 'lng', lng, 'acc', acc, 'at', updated_at))
      from evm_locations
      where evm_login(p_code) = 'admin'
         or coalesce((select value from evm_config where key = 'share_locations'), 'off') = 'on'), '[]'::json),
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
  v_ok := regexp_replace(lower(coalesce(p_text, '')), '\s', '', 'g') = regexp_replace(lower(v.answer), '\s', '', 'g');
  if v_ok then
    if v.rush then
      v.points := coalesce((array[30, 20, 10])[1 + (select count(*) from evm_scores where game_id = 'order:' || v.id)::int], 5);
    end if;
    insert into evm_scores (team_id, game_id, score) values (p_team, 'order:' || v.id, v.points)
    on conflict (team_id, game_id) do nothing;
  end if;
  return v_ok;
end $$;

-- 퀴즈. 초성(chosung)·성경(bible)·넌센스(nonsense)는 본부가 출제하고,
-- 몸으로 말해요(act)는 팀이 사진과 정답을 내면 본부가 승인해 출제한다.
-- status: pending(승인 대기) → draft(보관) → open(출제) → closed(마감)
create table if not exists evm_quizzes (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('chosung', 'bible', 'nonsense', 'act')),
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

create or replace function evm_norm(p_text text) returns text
language sql immutable as $$
  select regexp_replace(lower(coalesce(p_text, '')), '\s', '', 'g')
$$;

create or replace function evm_quiz_add(
  p_code text, p_kind text, p_body text, p_choices json, p_answer text, p_hint text, p_points int, p_open boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  if p_kind = 'act' or coalesce(btrim(p_answer), '') = '' or coalesce(btrim(p_body), '') = '' then
    raise exception 'EVM_BAD_QUIZ' using errcode = 'P0001';
  end if;
  insert into evm_quizzes (kind, body, choices, answer, hint, points, status)
  values (p_kind, left(btrim(p_body), 300), p_choices, btrim(p_answer), nullif(btrim(coalesce(p_hint, '')), ''), p_points,
          case when p_open then 'open' else 'draft' end);
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
  update evm_quizzes set status = 'open' where kind = p_kind and status = 'draft';
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

create or replace function evm_quiz_photo(p_code text, p_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  perform evm_require(p_code);
  return (select photo from evm_quizzes
          where id = p_id and (status in ('open', 'closed') or evm_login(p_code) = 'admin'));
end $$;

-- 답안 제출과 채점. 객관식은 한 번만, 나머지는 맞힐 때까지 낼 수 있다.
-- 초성 퀴즈는 힌트를 보면 절반 점수. 몸으로 말해요는 맞힌 팀마다 출제 팀도 절반 점수를 받는다.
create or replace function evm_quiz_answer(p_code text, p_team int, p_id bigint, p_text text, p_hint boolean) returns json
language plpgsql security definer set search_path = public as $$
declare q evm_quizzes%rowtype; v_ok boolean; v_choice boolean; v_points int := 0;
begin
  perform evm_require(p_code);
  select * into q from evm_quizzes where id = p_id and status = 'open';
  if not found then
    raise exception 'EVM_QUIZ_CLOSED' using errcode = 'P0001';
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
  v_choice := q.kind = 'bible' and q.choices is not null;
  if v_choice then
    v_ok := btrim(coalesce(p_text, '')) = q.answer;
  else
    v_ok := exists (
      select 1 from unnest(string_to_array(q.answer, ',')) k
      where evm_norm(k) <> ''
        and case when q.kind = 'bible' then evm_norm(p_text) like '%' || evm_norm(k) || '%'
                 else evm_norm(p_text) = evm_norm(k) end
    );
  end if;
  if v_ok then
    v_points := case when q.kind = 'chosung' and p_hint then (q.points + 1) / 2 else q.points end;
  end if;
  if v_ok or v_choice then
    insert into evm_scores (team_id, game_id, score) values (p_team, 'quiz:' || q.id, v_points)
    on conflict (team_id, game_id) do nothing;
  end if;
  if v_ok and q.author_team is not null then
    insert into evm_scores (team_id, game_id, score) values (q.author_team, 'qa:' || q.id || ':' || p_team, (q.points + 1) / 2)
    on conflict (team_id, game_id) do nothing;
  end if;
  return json_build_object('ok', v_ok, 'points', v_points,
    'answer', case when v_choice then q.answer end);
end $$;

drop function if exists evm_score(text, int, text, int);

create or replace function evm_locate(p_code text, p_team int, p_lat double precision, p_lng double precision, p_acc real) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, p_team = 0);
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'EVM_BAD_LOCATION' using errcode = 'P0001';
  end if;
  insert into evm_locations (team_id, lat, lng, acc) values (p_team, p_lat, p_lng, p_acc)
  on conflict (team_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, updated_at = now();
end $$;

-- 팀끼리 서로의 위치를 볼 수 있게 할지(본부).
create or replace function evm_share_locations(p_code text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform evm_require(p_code, true);
  insert into evm_config (key, value) values ('share_locations', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
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

-- 사진과 기록을 모두 지운다. 본부가 출제한 퀴즈 문제는 남는다.
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
  -- 팀이 낸 몸으로 말해요 문제는 지우고, 본부가 출제한 문제는 남긴다.
  delete from evm_quizzes where kind = 'act';
end $$;

revoke all on function evm_require(text, boolean) from public, anon, authenticated;
grant execute on function
  evm_login(text), evm_state(text), evm_submit(text, int, text, text), evm_remove(text, int, text),
  evm_photo(text, int, text), evm_cheer(text, int, text), evm_checkin(text, int),
  evm_notice(text, text), evm_wipe(text), evm_set_teams(text, int),
  evm_locate(text, int, double precision, double precision, real), evm_share_locations(text, boolean),
  evm_quiz_add(text, text, text, json, text, text, int, boolean), evm_quiz_seed(text, json), evm_quiz_set(text, bigint, text),
  evm_quiz_open_all(text, text), evm_quiz_delete(text, bigint), evm_act_submit(text, int, text, text),
  evm_quiz_photo(text, bigint), evm_quiz_answer(text, int, bigint, text, boolean),
  evm_order(text, text, text, text, int, boolean), evm_order_close(text, bigint), evm_answer(text, int, bigint, text)
to anon, authenticated;
