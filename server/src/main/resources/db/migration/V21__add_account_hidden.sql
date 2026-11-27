-- 계좌 숨기기(P-220, F-506, F-507, 이슈 #42). 숨긴 계좌는 새 거래에 고를 수 없고, 과거 거래와 잔액·통계에는 남는다.
-- 있는 계좌는 모두 보이는 계좌다. PostgreSQL 11부터 상수 기본값을 가진 열 더하기는 표를 다시 쓰지 않는다.
-- 이 열을 모르는 바로 전 버전 앱도 기본값으로 넣으므로 그대로 돈다. 되돌리기는 DROP COLUMN hidden이다.
ALTER TABLE account
    ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;
