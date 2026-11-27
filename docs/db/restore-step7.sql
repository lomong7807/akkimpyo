-- 전체 복원한 DB에 앱을 붙이기 전에 한 번 돌린다. 실제 복원과 복원 훈련이 같은 파일을 쓴다(restore-runbook.md 7번).
--
-- 무엇을: refresh token 행을 모두 지우고(테이블이 아직 없어 자리만 있다, #26), 모든 거래(휴지통 포함)의 version에 돌리는 시각의 epoch 초를 더한다.
-- 왜: 전체 복원을 하면 refresh token의 폐기와 거래의 version이 과거로 돌아간다. 복원 전 내용을 든 기기의 수정이
--     나중에 같은 version과 맞으면 충돌 없이 덮을 수 있다(ADR 008 결정 10, 추정).
-- 언제: 명세표 대조와 점검을 통과한 뒤, 앱을 붙이기 전. 같은 클러스터면 이름을 바꾸기 전에 <DB이름>_restore에 돌린다.
-- 누가: 운영 데이터를 바꾸는 파일이다. 실행은 owner 승인으로 한다.
-- 부분 복구에는 쓰지 않는다. 그때는 고친 거래만 version을 올리고 이력을 남긴다(restore-runbook.md 0번).
--
-- updated_at과 change_log는 건드리지 않는다. 사람 정보와 금액은 출력하지 않는다.
-- 이미 돌린 DB에 또 돌려도 version이 더 커질 뿐 해롭지 않아 막지 않는다.
-- 거래 테이블의 소유자나 슈퍼유저로, psql에서 돌린다. 멈추면 종료 코드가 0이 아니고 아무것도 바뀌지 않는다.
--   psql -X -U <역할> -d <DB이름>_restore < restore-step7.sql   (새 클러스터면 <DB이름>)

\set ON_ERROR_STOP on

BEGIN;

-- 안전 검사: 같은 DB에 다른 클라이언트 연결이 있으면 멈춘다.
-- 슈퍼유저가 아니면 다른 사용자의 연결은 backend_type이 NULL로 보인다. 그런 행도 연결로 센다.
-- 사용자가 없는 행(autovacuum 같은 것)은 세지 않는다.
DO $$
DECLARE
  others bigint;
BEGIN
  SELECT count(*) INTO others
    FROM pg_stat_activity
   WHERE datname = current_database()
     AND pid <> pg_backend_pid()
     AND (backend_type = 'client backend' OR (backend_type IS NULL AND usesysid IS NOT NULL));
  IF others > 0 THEN
    RAISE EXCEPTION '이 DB에 다른 연결이 %개 있다. 앱과 다른 접속을 모두 끊고 다시 돌린다. 아무것도 바꾸지 않았다.', others;
  END IF;
END
$$;

-- 자리: refresh token 행을 모두 지운다(ADR 008 결정 10 (가)). 테이블은 #26에서 만든다. 아직 없어 문장을 두지 않는다.
-- 문장을 넣을 때는 그 테이블이 없던 때의 백업에서도 멈추지 않게 한다.

SELECT extract(epoch FROM now())::bigint AS added \gset
UPDATE transaction SET version = version + extract(epoch FROM now())::bigint;
\set changed :ROW_COUNT

COMMIT;

\echo '바뀐 거래 행 수:' :changed
\echo '더한 값(epoch 초):' :added

VACUUM (ANALYZE) transaction;
