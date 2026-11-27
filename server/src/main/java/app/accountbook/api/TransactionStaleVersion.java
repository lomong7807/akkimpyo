package app.accountbook.api;

/**
 * 409 {@code STALE_VERSION}(ADR 002 5절, ADR 006 결정 5). {@code current}는 늘 있고, 응답과 같은 모양의 그 거래의 최신
 * 내용이다. 휴지통에 있으면 {@code deletedAt}이 있다. 컨트롤러가 표시 이름을 붙인 뒤 던진다.
 */
final class TransactionStaleVersion extends RuntimeException {

    private final transient TransactionResponse current;

    TransactionStaleVersion(TransactionResponse current) {
        super("다른 곳에서 먼저 바뀌었다", null, false, false);
        this.current = current;
    }

    TransactionResponse current() {
        return current;
    }
}
