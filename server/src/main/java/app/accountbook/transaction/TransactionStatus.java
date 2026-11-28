package app.accountbook.transaction;

public enum TransactionStatus {
    /**
     * 승인 대기. 문자 입력(P-503, 3단계)이 만든다. 지금은 만드는 경로가 없어 취소 직전 상태는 늘 완료다. 만드는 경로를 더할 때
     * 취소 직전 상태를 저장해 되돌리기({@link Transaction#uncancel})가 그 상태로 돌아가게 한다(P-208, #7).
     */
    PENDING,
    POSTED,
    /** 승인취소. 목록에는 보이고 잔액·통계에서는 빠진다. */
    CANCELED
}
