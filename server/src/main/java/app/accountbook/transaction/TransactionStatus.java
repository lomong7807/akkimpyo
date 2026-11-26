package app.accountbook.transaction;

public enum TransactionStatus {
    PENDING,
    POSTED,
    /** 승인취소. 목록에는 보이고 잔액·통계에서는 빠진다. */
    CANCELED,
    ARCHIVED
}
