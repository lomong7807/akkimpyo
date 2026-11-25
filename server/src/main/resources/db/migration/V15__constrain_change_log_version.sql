-- 변경 이력의 순서 번호 3/3(P-215, P-216, ADR 007 결정 7, 이슈 #60): 번호의 유일성과 장부를 DB가 지킨다.
-- 어긋난 행이 있으면 실패한다: 번호가 빈 이력, 한 거래에 같은 번호 둘, 거래의 지금 version보다 큰 번호, 없는 장부의 이력.
-- 이력은 고치지 않으므로(P-216) 여기서 바로잡지 않는다.

-- 거래의 지금 version보다 큰 번호가 남아 있으면 그 거래의 앞으로의 변경이 그 번호에서 아래 유니크에 걸린다.
DO $$
DECLARE
    ahead BIGINT;
BEGIN
    SELECT count(*) INTO ahead
      FROM change_log c
      JOIN transaction t ON t.id = c.transaction_id
     WHERE c.version > t.version;
    IF ahead > 0 THEN
        RAISE EXCEPTION '거래의 지금 version보다 번호가 큰 이력이 %건 있다(이슈 #60)', ahead;
    END IF;
END
$$;

ALTER TABLE change_log
    ALTER COLUMN version SET NOT NULL,
    ADD CONSTRAINT uq_change_log_transaction_version UNIQUE (transaction_id, version),
    -- 장부를 지우는 작업이 이력을 먼저 지운다. CASCADE에 기대지 않는다(ADR 007 결정 2).
    -- transaction_id는 V1처럼 FK가 아니다. 거래를 완전히 지워도 기록이 남아야 한다.
    ADD CONSTRAINT fk_change_log_ledger FOREIGN KEY (ledger_id) REFERENCES ledger (id);

-- 장부 단위 조회와 삭제, 그리고 장부를 지울 때의 FK 확인.
CREATE INDEX ix_change_log_ledger_created ON change_log (ledger_id, created_at);

-- 거래의 이력은 version 순서로 읽는다. 위 유니크의 인덱스가 대신한다.
DROP INDEX ix_change_log_transaction_created;
