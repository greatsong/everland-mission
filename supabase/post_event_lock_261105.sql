-- 행사 종료 잠금(2026-11-05 작성). 아직 운영 DB에 적용하지 않았다.
-- 행사(2026-10-24)가 끝났는데 어린이 사진을 읽는 함수가 4자리 입장 코드로 열려 있어서 만든다.
--
-- 실행하면 모든 evm_ 함수와 표의 anon, authenticated 권한을 회수한다. 앱은 더 이상 동작하지 않는다.
-- 코드와 행 자료는 바꾸지 않는다. 다시 열기 전에는 코드를 무작위 값으로 바꾼다.
-- 자료는 지우지 않는다. 사진을 내려받을 일이 있으면 이 파일을 실행하기 전에 끝낸다.
-- 자료를 지우려면 사진 보관 여부를 정한 뒤 supabase/teardown.sql을 실행한다.
-- 되돌리려면 schema.sql 끝의 grant 문을 다시 실행한다(evm_login 등 기본 권한 함수 포함 목록은 그 문에 있다).

begin;

do $$
declare
  f regprocedure;
  t regclass;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'evm\_%' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- TRUNCATE는 RLS로 막히지 않으므로 표 권한도 회수한다.
  for t in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'evm\_%' and c.relkind = 'r'
  loop
    execute format('revoke all on table %s from public, anon, authenticated', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
