-- 계좌 이름 규칙(P-220)과 시작 잔액 범위(P-201, F-502), 이슈 #6.
-- 이름: 앞뒤 공백 없는 1~50자, 같은 장부 안에서 중복 금지. 시작 잔액: ±9,999,999,999원 안. 값은 앱의 AccountService와 같아야 한다.
-- 이미 어긋난 행(같은 장부의 같은 이름, 빈 이름, 앞뒤 공백이 있는 이름, 범위를 벗어난 시작 잔액)이 있으면 실패한다.
-- 그 행을 먼저 고친 뒤 다시 적용한다.
ALTER TABLE account
    ALTER COLUMN name TYPE text,
    ADD CONSTRAINT ck_account_name_length CHECK (char_length(name) BETWEEN 1 AND 50),
    -- 앱을 거치지 않는 경로로 '생활비 '가 들어와 '생활비'와 다른 이름이 되는 것을 막는다. btrim은 공백 문자(U+0020)만 지운다.
    ADD CONSTRAINT ck_account_name_trimmed CHECK (name = btrim(name)),
    -- 계좌는 소프트 삭제가 없으므로 부분 유니크가 아니다. 숨긴 계좌(#42)도 이름 중복에 포함된다.
    ADD CONSTRAINT uq_account_name UNIQUE (ledger_id, name),
    -- 시작 잔액은 부호가 있다(카드 부채와 마이너스 통장은 음수). 0도 된다.
    ADD CONSTRAINT ck_account_opening_balance_range
        CHECK (opening_balance BETWEEN -9999999999 AND 9999999999);
