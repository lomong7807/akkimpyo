-- 환불과 돌려받음의 구분(F-206, F-207, P-209, P-210, 이슈 #8, 계약 #102): 지출 거래에 refund_kind를 더한다.
-- 값은 REFUND(환불), REIMBURSEMENT(돌려받음)이고 일반 지출과 수입·이체는 NULL이다. 두 구분 모두 라인 금액이 양수다.
-- 값 목록은 앱의 RefundKind와 같아야 한다(V16, SchemaValueMatchTest). 라인 부호와 구분 값이 맞는지(지출 라인 양수 ⇔
-- refund_kind 있음)는 테이블이 달라 CHECK로 걸지 않고 앱이 같은 트랜잭션에서 함께 쓴다.
--
-- 기존 행 옮기기 규칙: 지출이고 라인 금액이 양수인 거래는 REFUND, 나머지는 NULL로 둔다. #8 전에는 양수 지출 라인이 곧
-- 환불(refund=true)이었고 돌려받음은 없었다. 뜻이 바뀌지 않는 표현 변경이라 version, updated_at, change_log는 건드리지
-- 않는다. 버전 1 이력 행은 고치지 않고 앱이 읽을 때 같은 규칙으로 채운다(ChangeLogValue.read).
-- CHECK는 옮긴 뒤에 걸어 옮긴 행까지 검증한다.
--
-- 되돌리기: 칸을 지우면 V23의 스키마로 돌아간다. 바로 전 버전 앱은 refund_kind를 모른 채 이 스키마에서 돈다(새 행은 NULL).
-- 이 앱이 형식 버전 2 이력을 저장한 뒤에 앱만 이전 버전으로 돌리면 그 거래의 이력 조회가 실패하고(이전 앱에 없는
-- 형식 버전), 이전 앱이 환불을 고쳐 음수로 바꾼 행에는 refund_kind가 남는다. 그때는 앱을 다시 올려 앞으로 고친다.
ALTER TABLE transaction
    ADD COLUMN refund_kind text;

UPDATE transaction t
   SET refund_kind = 'REFUND'
 WHERE t.type = 'EXPENSE'
   AND EXISTS (SELECT 1
                 FROM transaction_line l
                WHERE l.transaction_id = t.id
                  AND l.ledger_id = t.ledger_id
                  AND l.amount > 0);

ALTER TABLE transaction
    ADD CONSTRAINT ck_transaction_refund_kind_values CHECK (refund_kind IN ('REFUND', 'REIMBURSEMENT')),
    ADD CONSTRAINT ck_transaction_refund_kind_expense CHECK (refund_kind IS NULL OR type = 'EXPENSE');
