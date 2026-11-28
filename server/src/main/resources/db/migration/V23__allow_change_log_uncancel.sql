-- 승인취소 되돌리기의 이력(F-226, P-216, 이슈 #7): change_log.action에 UNCANCEL을 더한다. V22의 CATEGORY_MOVE는 그대로 둔다.
-- 값 목록은 앱의 ChangeAction과 같아야 한다(V16, SchemaValueMatchTest). 기존 행은 모두 이전 목록 안의 값이라 새 CHECK를 지난다.
-- 바로 전 버전 앱은 UNCANCEL을 쓰지 않아 이 스키마에서 그대로 돈다. 이 값이 저장된 뒤에 앱만 이전 버전으로 돌리면
-- 그 거래의 이력 행을 읽는 조회(상세의 고친 사람, 이력)가 실패한다(이전 앱의 ChangeAction에 없는 값). 그때는 앱을 다시
-- 올려 앞으로 고친다.
ALTER TABLE change_log
    DROP CONSTRAINT ck_change_log_action_values,
    ADD CONSTRAINT ck_change_log_action_values
        CHECK (action IN ('CREATE', 'UPDATE', 'CANCEL', 'UNCANCEL', 'DELETE', 'RESTORE', 'PURGE', 'AUTO_PURGE',
                          'CATEGORY_MOVE'));
