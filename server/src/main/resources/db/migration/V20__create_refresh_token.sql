-- refresh token의 계열과 토큰(ADR 001 결정 3, #26, dba와 정함). 새 테이블뿐이라 바로 전 버전 앱과 맞는다.
-- 토큰 행은 넣은 뒤 바꾸지 않는다. 지금 토큰, 바로 앞 토큰, 그 회전 시각, 폐기 시각은 계열 행에 있고 갱신과 폐기는
-- 계열 행을 잠그고 판단한다. 행은 재사용 감지를 위해 계열의 절대 만료까지 남긴다(정리는 #132).

CREATE TABLE refresh_token_family (
    id                  UUID        NOT NULL,
    user_id             UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL, -- 계열의 시작(로그인한 때)
    absolute_expires_at TIMESTAMPTZ NOT NULL, -- 시작부터 180일(P-106). 회전해도 바뀌지 않는다
    -- 지금 토큰과 바로 앞 토큰(가장 최근 정상 회전에서 바뀐 토큰). 두 테이블이 서로 가리키지 않게 FK를 걸지 않는다.
    current_token_id    UUID        NOT NULL,
    previous_token_id   UUID,
    rotated_at          TIMESTAMPTZ,          -- 그 정상 회전의 시각. 허용 시간을 여기서부터 잰다
    revoked_at          TIMESTAMPTZ,          -- 폐기 시각. 폐기는 계열 단위다
    CONSTRAINT pk_refresh_token_family PRIMARY KEY (id),
    CONSTRAINT fk_refresh_token_family_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT ck_refresh_token_family_expiry CHECK (absolute_expires_at > created_at),
    CONSTRAINT ck_refresh_token_family_previous CHECK ((previous_token_id IS NULL) = (rotated_at IS NULL)
                                                       AND previous_token_id <> current_token_id)
);

-- 비밀번호 바꾸기의 다른 계열 폐기와 사용자를 지울 때의 FK 확인.
CREATE INDEX ix_refresh_token_family_user ON refresh_token_family (user_id);

CREATE TABLE refresh_token (
    id         UUID        NOT NULL,
    family_id  UUID        NOT NULL,
    token_hash BYTEA       NOT NULL, -- 값의 SHA-256. 원문은 저장하지 않는다
    created_at TIMESTAMPTZ NOT NULL, -- 준 시각
    expires_at TIMESTAMPTZ NOT NULL, -- 준 시각부터 30일. 계열의 절대 만료를 넘지 않는다
    CONSTRAINT pk_refresh_token PRIMARY KEY (id),
    CONSTRAINT uq_refresh_token_hash UNIQUE (token_hash), -- 갱신, 로그아웃, 로그인의 쿠키 조회
    CONSTRAINT fk_refresh_token_family FOREIGN KEY (family_id) REFERENCES refresh_token_family (id),
    CONSTRAINT ck_refresh_token_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT ck_refresh_token_expiry CHECK (expires_at > created_at)
);

-- 계열을 지울 때(#132 정리, 사용자 삭제)의 FK 확인.
CREATE INDEX ix_refresh_token_family ON refresh_token (family_id);
