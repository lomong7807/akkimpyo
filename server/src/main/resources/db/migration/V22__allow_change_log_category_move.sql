-- 카테고리 삭제에 따른 거래 이동의 이력(F-512, P-216, 이슈 #3): change_log.action에 CATEGORY_MOVE를 더한다.
-- 값 목록은 앱의 ChangeAction과 같아야 한다(V16, SchemaValueMatchTest). 기존 행은 모두 이전 목록 안의 값이라 새 CHECK를 지난다.
-- 바로 전 버전 앱은 CATEGORY_MOVE를 쓰지 않아 이 스키마에서 그대로 돈다. 이 값이 저장된 뒤에 앱만 이전 버전으로 돌리면
-- 그 거래의 이력 조회가 실패한다(이전 앱의 ChangeAction에 없는 값). 그때는 앱을 다시 올려 앞으로 고친다.
ALTER TABLE change_log
    DROP CONSTRAINT ck_change_log_action_values,
    ADD CONSTRAINT ck_change_log_action_values
        CHECK (action IN ('CREATE', 'UPDATE', 'CANCEL', 'DELETE', 'RESTORE', 'PURGE', 'AUTO_PURGE', 'CATEGORY_MOVE'));
