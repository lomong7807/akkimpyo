-- 이름을 조합형(NFC)으로 맞춘다(P-214, 이슈 #123). 채우기만 한다. 제약은 V18이 건다.
-- 계좌 이름, 카테고리 이름, 표시 이름. 가맹점과 메모는 채우지 않는다. 거래 내용을 version과 이력 없이 바꾸게 되기
-- 때문이다(ADR 006 결정 3). dba 결정(2026-11-26, #102).
-- 바꾼 뒤 같은 장부의 다른 이름과 같아지거나(uq_account_name, uq_category_name) 글자 수 상한을 넘으면 실패하고 아무것도
-- 바뀌지 않는다. 그 행을 먼저 고친 뒤 다시 적용한다(적용 전 확인 쿼리: 이슈 #123을 닫는 PR 본문, TextMigrationTest).
-- updated_at은 바꾸지 않는다. 보이는 글자와 뜻은 그대로이고 바이트 표현만 바뀐다.
-- 되돌리지 않는다. 원래의 분해형 바이트는 남지 않는다.

UPDATE account
   SET name = normalize(name, NFC)
 WHERE name IS NOT NFC NORMALIZED;

UPDATE category
   SET name = normalize(name, NFC)
 WHERE name IS NOT NFC NORMALIZED;

UPDATE users
   SET display_name = normalize(display_name, NFC)
 WHERE display_name IS NOT NFC NORMALIZED;
