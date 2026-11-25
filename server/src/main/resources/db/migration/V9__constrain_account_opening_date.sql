-- 계좌 기준일 하한(P-202, P-206, F-502, F-503), 이슈 #161. 값은 앱의 LedgerDates와 같아야 한다(거래 날짜의 하한과도 같다, V5).
-- 이미 어긋난 행(기준일이 2000-01-01보다 앞)이 있으면 실패한다. 그 행을 먼저 고친 뒤 다시 적용한다.
-- 상한("오늘로부터 1년 뒤")은 시간이 지나면 달라지는 조건이라 CHECK로 걸지 않는다. 앱 검사로 둔다.
ALTER TABLE account
    ADD CONSTRAINT ck_account_opening_date_min CHECK (opening_date >= DATE '2000-01-01');
