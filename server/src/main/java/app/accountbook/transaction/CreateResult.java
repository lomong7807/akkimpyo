package app.accountbook.transaction;

/**
 * 만들기의 결과.
 *
 * @param transaction 새로 만든 거래, 또는 이미 저장돼 있던 거래의 지금 내용
 * @param created     새로 만들었으면 true, 재전송이라 만들지 않았으면 false(API의 201과 200, ADR 006 결정 3)
 */
public record CreateResult(TransactionView transaction, boolean created) {
}
