-- 에버랜드 미션이 만든 것만 지운다. 행사 뒤 정리용.
drop function if exists evm_login(text), evm_require(text, boolean), evm_state(text),
  evm_submit(text, int, text, text), evm_remove(text, int, text), evm_photo(text, int, text),
  evm_cheer(text, int, text), evm_checkin(text, int), evm_notice(text, text), evm_wipe(text), evm_set_teams(text, int), evm_score(text, int, text, int),
  evm_quiz_add(text, text, text, json, text, text, int, boolean), evm_quiz_seed(text, json), evm_quiz_set(text, bigint, text),
  evm_quiz_open_all(text, text), evm_quiz_delete(text, bigint), evm_act_submit(text, int, text, text),
  evm_quiz_photo(text, bigint), evm_quiz_answer(text, int, bigint, text, boolean), evm_norm(text), evm_locate(text, int, double precision, double precision, real), evm_share_locations(text, boolean),
  evm_order(text, text, text, text, int, boolean), evm_order_close(text, bigint), evm_answer(text, int, bigint, text);
drop table if exists evm_submissions, evm_notices, evm_checkins, evm_scores, evm_orders, evm_quizzes, evm_locations, evm_config;
