-- 거래 라인의 장부 경계 1/3(P-203, P-314, 이슈 #58): 복합 FK가 가리킬 대상과 라인의 ledger_id를 더한다.
-- 채우기는 V11, NOT NULL과 복합 FK는 V12다. 세 파일은 서버가 멈춘 채 한 번에 적용한다.
-- V11과 V12 사이에 이전 앱이 라인을 넣으면 ledger_id가 비어 V12가 실패한다.

-- id가 이미 기본키라 새로 막는 것은 없다.
ALTER TABLE transaction
    ADD CONSTRAINT uq_transaction_id_ledger UNIQUE (id, ledger_id);
ALTER TABLE account
    ADD CONSTRAINT uq_account_id_ledger UNIQUE (id, ledger_id);
ALTER TABLE category
    ADD CONSTRAINT uq_category_id_ledger UNIQUE (id, ledger_id);

ALTER TABLE transaction_line
    ADD COLUMN ledger_id UUID NULL;
