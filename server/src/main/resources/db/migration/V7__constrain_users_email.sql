-- 이메일 규칙(P-101, 이슈 #20): 정규화한(앞뒤 공백 없음, 소문자) ASCII 인쇄 가능 문자 1~254자. 값은 앱의 UserService와 같아야 한다.
-- V1의 UNIQUE (email)(제약 이름 users_email_key)은 그대로 둔다. 아래 CHECK와 합쳐 대소문자나 앞뒤 공백만 다른 이메일 두 개를 막는다.
-- 이미 어긋난 행(대문자, 공백, 제어 문자, ASCII 밖 글자, 빈 값, 254자 초과)이 있으면 실패한다. 그 행을 먼저 고친 뒤 다시 적용한다.
ALTER TABLE users
    ALTER COLUMN email TYPE text,
    ADD CONSTRAINT ck_users_email_length CHECK (char_length(email) <= 254),
    -- U+0021~U+007E에서 대문자 A-Z만 뺀 것이다. COLLATE "C"라 DB 로캘과 무관하다.
    ADD CONSTRAINT ck_users_email_normalized CHECK ((email COLLATE "C") ~ '^[\x21-\x40\x5B-\x7E]+$');
