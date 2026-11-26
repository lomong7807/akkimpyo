-- 테이블 전체를 훑던 조회 세 곳에 인덱스를 더한다(이슈 #67).
-- 공개 전이라 CONCURRENTLY 없이 한 파일에 둔다(migration-standards 2절). 테이블을 다시 쓰지 않고 바로 전 버전 앱과 맞는다.

-- 카테고리를 지우기 전 확인(existsByCategoryId)과 카테고리 삭제의 FK 확인(fk_transaction_line_category).
-- 카테고리가 장부를 정하므로(복합 FK) ledger_id를 더해도 고르는 행이 줄지 않는다. 카테고리가 없는 이체 라인은 담지 않는다.

-- 사람이 속한 장부 찾기(findByUserId)와 사람을 지울 때(#109)의 FK 확인.
-- UNIQUE (ledger_id, user_id)는 user_id가 둘째 컬럼이라 쓰지 못한다.

-- 하위 분류가 있는지 확인(existsByParentId). 상위를 지울 때의 FK 확인(fk_category_parent)은
-- uq_category_name (ledger_id, kind, parent_id, name)의 앞 세 컬럼이 이미 받친다.
-- 변이(되돌린다): 인덱스 세 문장을 뺐다. 계획 테스트가 실패해야 한다.
