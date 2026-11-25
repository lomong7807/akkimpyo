-- 거래 라인의 장부 경계 3/3(P-203, P-314, 이슈 #58): 라인은 거래, 계좌, 카테고리와 같은 장부에 속한다.
-- 다른 장부의 계좌나 카테고리를 가리키는 라인이 이미 있거나 ledger_id가 빈 라인이 있으면 실패한다.
-- 그 행을 먼저 고친 뒤 다시 적용한다.
ALTER TABLE transaction_line
    ALTER COLUMN ledger_id SET NOT NULL,
    -- V1의 이름 없는 단일 컬럼 FK 셋. 아래 복합 FK가 대신한다.
    DROP CONSTRAINT transaction_line_transaction_id_fkey,
    DROP CONSTRAINT transaction_line_account_id_fkey,
    DROP CONSTRAINT transaction_line_category_id_fkey,
    -- 삭제·수정 동작은 V1과 같다: 거래를 지우면 라인을 함께 지우고(P-203), 나머지는 기본값(거부)이다.
    ADD CONSTRAINT fk_transaction_line_transaction FOREIGN KEY (transaction_id, ledger_id)
        REFERENCES transaction (id, ledger_id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_transaction_line_account FOREIGN KEY (account_id, ledger_id)
        REFERENCES account (id, ledger_id),
    -- category_id가 NULL인 이체 라인은 검사하지 않는다(MATCH SIMPLE).
    ADD CONSTRAINT fk_transaction_line_category FOREIGN KEY (category_id, ledger_id)
        REFERENCES category (id, ledger_id);
