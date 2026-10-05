#!/bin/bash
# 시험·행사 진행 상황과 문제를 한 번에 본다. 사용: scripts/monitor.sh [최근 몇 분, 기본 120]
# 읽기만 한다. 사진 본문과 코드는 출력하지 않는다.
MIN=${1:-120}
REF=fipdcjhtfslinfmalwjn
q() { npx -y supabase@latest db query --linked --project-ref "$REF" "$1" 2>/dev/null | python3 -c "
import json,sys
try:
    rows=json.load(sys.stdin).get('rows',[])
except Exception as e:
    print('  (조회 실패)'); sys.exit()
if not rows: print('  (없음)')
for r in rows: print('  '+' | '.join(f'{k}={v}' for k,v in r.items() if v is not None))"; }
echo "== 현재 건수"
q "select (select count(*) from evm_submissions) as 사진, (select count(*) from evm_scores) as 점수기록, (select count(*) from evm_orders) as 지령, (select count(*) from evm_quizzes) as 퀴즈, (select count(*) from evm_teams) as 팀소개, (select count(*) from evm_locations) as 위치, (select count(*) from evm_location_log) as 경로점, (select count(*) from evm_events) as 점검기록"
echo "== 최근 ${MIN}분 활동(팀별)"
q "select t as 팀, (select count(*) from evm_submissions where team_id=t and created_at > now()-interval '${MIN} minutes') as 사진, (select count(*) from evm_scores where team_id=t and created_at > now()-interval '${MIN} minutes') as 점수기록, (select to_char(max(updated_at) at time zone 'Asia/Seoul','HH24:MI') from evm_locations where team_id=t) as 마지막위치, (select to_char(max(checked_at) at time zone 'Asia/Seoul','HH24:MI') from evm_checkins where team_id=t) as 인원확인 from generate_series(1,6) t"
echo "== 최근 ${MIN}분 문제(정상 흐름의 거부 제외)"
q "select to_char(created_at at time zone 'Asia/Seoul','HH24:MI:SS') as 시각, coalesce(team_id::text,'-') as 팀, kind as 종류, message as 내용, case when ua ~* 'KAKAOTALK' then '카카오톡 안' when ua ~ 'iPhone|iPad' then 'iOS' when ua ~ 'Android' then '안드로이드' else '기타' end as 기기 from evm_events where created_at > now()-interval '${MIN} minutes' and (kind in ('error','offline','photo') or (kind='rpc' and message !~ 'EVM_(QUIZ_DONE|QUIZ_CLOSED|ORDER_CLOSED|OWN_QUIZ|ACT_EXISTS|BAD_CODE)') or (kind='geo' and message ~ '실패|없음')) order by id desc limit 40"
echo "== 최근 ${MIN}분 입장 기기"
q "select coalesce(team_id::text,'-') as 팀, case when ua ~* 'KAKAOTALK' then '카카오톡 안' when ua ~ 'SamsungBrowser' then '삼성 인터넷' when ua ~ 'CriOS|Chrome' then '크롬' when ua ~ 'Safari' then '사파리' else '기타' end as 브라우저, case when ua ~ 'iPhone|iPad' then 'iOS' when ua ~ 'Android' then '안드로이드' else '컴퓨터·기타' end as 기기, count(*) as 횟수, to_char(max(created_at) at time zone 'Asia/Seoul','HH24:MI') as 마지막 from evm_events where kind='enter' and created_at > now()-interval '${MIN} minutes' group by 1,2,3 order by 1"
