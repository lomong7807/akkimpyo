-- 거래 금액 범위(P-201)와 날짜 하한(P-202), 이슈 #5. 값은 앱의 TransactionLimits와 같아야 한다.
-- 이미 어긋난 행(라인 금액이 ±9,999,999,999를 벗어남, 거래 날짜가 2000-01-01보다 앞)이 있으면 실패한다.
-- 그 행을 먼저 고친 뒤 다시 적용한다.

ALTER TABLE transaction_line
    -- V1의 이름 없는 CHECK (amount <> 0). 아래 제약이 0도 막으므로 지운다.
    DROP CONSTRAINT transaction_line_amount_check,
    -- 라인 금액은 부호가 있다(잔액을 늘리면 양수, 줄이면 음수). 크기는 1원부터 9,999,999,999원까지다.
    ADD CONSTRAINT ck_transaction_line_amount_range
        CHECK (amount BETWEEN -9999999999 AND 9999999999 AND amount <> 0);

-- 날짜 상한("오늘부터 1년 뒤")은 시간이 지나면 달라지는 조건이라 CHECK로 걸지 않는다. 앱 검사로 둔다.
ALTER TABLE transaction
    ADD CONSTRAINT ck_transaction_occurred_on_min CHECK (occurred_on >= DATE '2000-01-01');
