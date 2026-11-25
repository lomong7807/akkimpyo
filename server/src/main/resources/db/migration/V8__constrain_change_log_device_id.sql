-- 변경 이력의 기기 값 형식(P-216, ADR 007 결정 10, 이슈 #21): 1~64자, A-Z a-z 0-9 . _ : - 만. 값은 앱의 DeviceIds와 같아야 한다.
-- NULL은 V1처럼 허용한다(CHECK는 NULL을 통과시킨다). 완전 삭제 기록과 탈퇴 정리는 기기 값을 비운다(ADR 007 결정 2, 5).
-- 이미 어긋난 행(빈 값, 64자 초과, 그 밖의 글자)이 있으면 실패한다.
ALTER TABLE change_log
    ALTER COLUMN device_id TYPE text,
    -- COLLATE "C"라 글자 구간이 DB 로캘과 무관하다. $는 값의 끝만 뜻해 끝의 줄바꿈도 걸린다.
    ADD CONSTRAINT ck_change_log_device_id_format
        CHECK ((device_id COLLATE "C") ~ '^[A-Za-z0-9._:-]{1,64}$');
