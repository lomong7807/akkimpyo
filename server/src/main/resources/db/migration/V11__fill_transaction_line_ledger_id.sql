-- 거래 라인의 장부 경계 2/3(이슈 #58): 기존 라인을 거래의 ledger_id로 채운다. 지운 거래와 취소한 거래의 라인도 채운다.
UPDATE transaction_line l
   SET ledger_id = t.ledger_id
  FROM transaction t
 WHERE t.id = l.transaction_id;
