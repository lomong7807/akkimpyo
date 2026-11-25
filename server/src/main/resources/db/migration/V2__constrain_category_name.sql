-- 카테고리 이름 규칙(P-221, 이슈 #2): 앞뒤 공백 없는 1~20자, 같은 상위 아래(최상위끼리 포함) 중복 금지.
-- 이미 20자를 넘거나 앞뒤에 공백이 있거나 중복인 행이 있으면 실패한다. 그 행을 먼저 고친 뒤 다시 적용한다.
ALTER TABLE category
    ALTER COLUMN name TYPE text,
    ADD CONSTRAINT ck_category_name_length CHECK (char_length(name) BETWEEN 1 AND 20),
    -- 앱을 거치지 않는 경로로 '식비 '가 들어와 '식비'와 다른 이름이 되는 것을 막는다. btrim은 공백 문자(U+0020)만 지운다.
    ADD CONSTRAINT ck_category_name_trimmed CHECK (name = btrim(name)),
    -- NULLS NOT DISTINCT: parent_id가 NULL인 최상위끼리도 같은 이름을 막는다.
    ADD CONSTRAINT uq_category_name UNIQUE NULLS NOT DISTINCT (ledger_id, kind, parent_id, name);
