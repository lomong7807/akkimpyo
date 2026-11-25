-- 표시 이름 규칙(P-101, 이슈 #4): 앞뒤 공백 없는 1~20자. 다른 사람과 겹쳐도 되므로 유니크는 걸지 않는다.
-- 이미 20자를 넘거나 비었거나 앞뒤에 공백이 있는 행이 있으면 실패한다. 그 행을 먼저 고친 뒤 다시 적용한다.
ALTER TABLE users
    ALTER COLUMN display_name TYPE text,
    ADD CONSTRAINT ck_users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 20),
    -- 앱을 거치지 않는 경로로 '주인 '이 들어오는 것을 막는다. btrim은 공백 문자(U+0020)만 지운다.
    ADD CONSTRAINT ck_users_display_name_trimmed CHECK (display_name = btrim(display_name));
