package app.accountbook.transaction;

/**
 * 요청의 version이 저장된 version과 다르다. 다른 곳에서 먼저 바꿨으므로 아무것도 바꾸지 않는다(ADR 006 결정 5).
 * 휴지통에 있는 거래여도 이것이고, 그때 {@link #current()}의 {@code deletedAt}이 있다(ADR 002 5절).
 */
public class StaleVersionException extends RuntimeException {

    private final TransactionView current;

    StaleVersionException(TransactionView current) {
        super("다른 곳에서 먼저 바뀌었습니다. 최신 내용을 다시 불러와 주세요.");
        this.current = current;
    }

    /** 화면이 내 입력과 나란히 보여 줄 그 거래의 최신 내용(F-909). 거래와 라인을 한 시점에 읽은 것이다(#36). */
    public TransactionView current() {
        return current;
    }
}
