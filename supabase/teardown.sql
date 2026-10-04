-- 에버랜드 미션이 만든 것만 지운다. 행사 뒤 정리용.
drop function if exists evm_login(text), evm_require(text, boolean), evm_state(text),
  evm_submit(text, int, text, text), evm_remove(text, int, text), evm_photo(text, int, text),
  evm_cheer(text, int, text), evm_checkin(text, int), evm_notice(text, text), evm_wipe(text), evm_set_teams(text, int), evm_score(text, int, text, int),
  evm_order(text, text, text, text, int), evm_order_close(text, bigint), evm_answer(text, int, bigint, text);
drop table if exists evm_submissions, evm_notices, evm_checkins, evm_scores, evm_orders, evm_config;
