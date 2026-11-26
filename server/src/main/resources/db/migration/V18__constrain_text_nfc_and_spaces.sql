-- 사용자가 넣는 글자의 DB 제약(P-214, 이슈 #123). 앱의 common/UserText가 통과시킨 값은 여기에 걸리지 않는다.
-- dba 결정(2026-11-26, #102).
--   *_nfc        조합형(NFC)으로 저장한다. 분해형으로 넣은 같은 이름이 유니크를 뚫지 못한다.
--   *_trimmed    앞뒤에 공백류가 없다. 공백류는 유니코드 Zs 17자이고 앱의 UserText.TRIMMED_SPACES와 같아야 한다
--                (TextSchemaTest가 비교한다). btrim(col)은 U+0020만 지워 U+00A0, U+3000이 앞뒤에 남은 이름을 받았다.
--   *_no_control 제어 문자(C0 U+0001~U+001F, U+007F, C1 U+0080~U+009F)가 없다. 메모는 줄바꿈(U+000A)만 받는다.
--                U+0000은 text에 담을 수 없어 범위에서 뺀다. COLLATE "C"로 로캘과 무관하게 코드포인트로 본다(V7과 같은 방식).
-- 서식 문자(Cf), 보이지 않는 글자, 이모지 자리의 예외는 글자의 자리까지 보는 규칙이라 정규식으로 똑같이 걸 수 없다. 앱 검사로 둔다.
-- 짝 없는 서로게이트는 UTF-8 DB에 담을 수 없어 CHECK가 필요 없다(security).
--
-- 이름(계좌, 카테고리, 표시 이름)은 V17이 NFC로 채운 뒤다. 가맹점과 메모는 채우지 않는다. 운영에 거래 행이 없는 지금
-- 바로 검증되는 CHECK로 건다. 거래가 쌓인 뒤에는 채울 수 없고(ADR 006 결정 3), NOT VALID로는 옛 행의 UPDATE가 실패한다.
-- 이미 어긋난 행(앞뒤 공백류나 제어 문자가 든 이름, 분해형·앞뒤 공백류·빈 문자열·제어 문자가 든 가맹점, 분해형이거나
-- 줄바꿈 밖의 제어 문자가 든 메모)이 있으면 실패한다. 여기서 고치지 않는다. 그 행을 먼저 고친 뒤 다시 적용한다.
-- 되돌릴 때는 새 마이그레이션으로 *_nfc, *_no_control, 가맹점·메모의 제약을 지우고 이름의 *_trimmed를
-- CHECK (col = btrim(col))로 되돌린다. V17의 NFC 채우기는 되돌리지 않는다.

ALTER TABLE account
    DROP CONSTRAINT ck_account_name_trimmed,
    ADD CONSTRAINT ck_account_name_trimmed CHECK (name = btrim(name,
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')),
    ADD CONSTRAINT ck_account_name_nfc CHECK (name IS NFC NORMALIZED),
    ADD CONSTRAINT ck_account_name_no_control CHECK ((name COLLATE "C") !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE category
    DROP CONSTRAINT ck_category_name_trimmed,
    ADD CONSTRAINT ck_category_name_trimmed CHECK (name = btrim(name,
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')),
    ADD CONSTRAINT ck_category_name_nfc CHECK (name IS NFC NORMALIZED),
    ADD CONSTRAINT ck_category_name_no_control CHECK ((name COLLATE "C") !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE users
    DROP CONSTRAINT ck_users_display_name_trimmed,
    ADD CONSTRAINT ck_users_display_name_trimmed CHECK (display_name = btrim(display_name,
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')),
    ADD CONSTRAINT ck_users_display_name_nfc CHECK (display_name IS NFC NORMALIZED),
    ADD CONSTRAINT ck_users_display_name_no_control
        CHECK ((display_name COLLATE "C") !~ '[\x01-\x1F\x7F-\x9F]');

-- NULL은 CHECK를 지난다. 앱은 빈 가맹점·메모와 공백류뿐인 가맹점을 NULL로 저장한다.
ALTER TABLE transaction
    ADD CONSTRAINT ck_transaction_payee_nfc CHECK (payee IS NFC NORMALIZED),
    ADD CONSTRAINT ck_transaction_payee_trimmed CHECK (payee = btrim(payee,
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000')
        AND payee <> ''),
    ADD CONSTRAINT ck_transaction_payee_no_control CHECK ((payee COLLATE "C") !~ '[\x01-\x1F\x7F-\x9F]'),
    ADD CONSTRAINT ck_transaction_memo_nfc CHECK (memo IS NFC NORMALIZED),
    -- 메모는 앞뒤를 지우지 않으므로 trimmed가 없다. \r은 앱이 \n으로 바꾼 뒤라 거부한다.
    ADD CONSTRAINT ck_transaction_memo_no_control
        CHECK ((memo COLLATE "C") !~ '[\x01-\x09\x0B-\x1F\x7F-\x9F]');
