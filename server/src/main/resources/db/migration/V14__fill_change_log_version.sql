-- 변경 이력의 순서 번호 2/3(이슈 #60): 기존 행을 그 변경 뒤의 거래 version으로 채운다. 그 값은 after_value에 적혀 있다.
-- created_at 순서로 매기지 않는다. 전체 복원이 거래의 version을 크게 올리면(ADR 008 결정 10) 순서 번호가 version과 달라지고,
-- created_at이 같은 두 행은 순서를 정할 수 없다.
-- after_value에 version이 없는 행은 빈 채로 남아 V15가 실패한다. 짐작해서 채우지 않는다.
UPDATE change_log
   SET version = (after_value ->> 'version')::bigint;
