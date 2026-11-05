-- 행사 종료 잠금(2026-11-05 작성). 아직 운영 DB에 적용하지 않았다.
-- 행사(2026-10-24)가 끝났는데 어린이 사진을 읽는 함수가 4자리 입장 코드로 열려 있어서 만든다.
--
-- 실행하면 다음이 바뀐다.
--   1. 입장 코드, 본부 코드, 버스 퀴즈 코드를 무작위 값으로 바꾼다.
--   2. 모든 evm_ 함수의 anon, authenticated 실행 권한을 회수한다. 앱은 더 이상 동작하지 않는다.
-- 자료는 지우지 않는다. 사진을 내려받을 일이 있으면 이 파일을 실행하기 전에 끝낸다.
-- 자료를 지우려면 사진 보관 여부를 정한 뒤 supabase/teardown.sql을 실행한다.
-- 되돌리려면 schema.sql 끝의 grant 문을 다시 실행한다.

begin;

update evm_config
set value = replace(gen_random_uuid()::text, '-', '')
where key in ('admin_code', 'join_code', 'quiz_code');

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'evm\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
