-- 변경 이력의 순서 번호 1/3(P-215, P-216, ADR 007, 이슈 #60): 번호와 형식 버전 열을 더하고 actor_id를 비울 수 있게 한다.
-- 채우기는 V14, NOT NULL과 유니크, 장부 FK는 V15다. 세 파일은 서버가 멈춘 채 한 번에 적용한다.
-- V14와 V15 사이에 이전 앱이 이력을 넣으면 version이 비어 V15가 실패한다.
ALTER TABLE change_log
    -- 그 변경 뒤의 거래 version.
    ADD COLUMN version BIGINT NULL,
    -- 전후 값의 형식 버전(ADR 007 결정 4). 지금 있는 행은 1이다.
    ADD COLUMN format_version SMALLINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT ck_change_log_format_version_min CHECK (format_version >= 1),
    -- 서버가 한 일과 탈퇴한 사람의 자리는 비운다(ADR 007 결정 5, 6).
    ALTER COLUMN actor_id DROP NOT NULL;
