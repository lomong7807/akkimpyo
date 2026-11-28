package app.accountbook.api;

/**
 * 409 {@code ID_CONFLICT}(ADR 002 5절, ADR 006 결정 3). 같은 장부에서 내가 만든 거래와 내용이 다르면 {@code current}에
 * 응답과 같은 모양의 그 거래가 있고, 그 밖(다른 장부의 id, 다른 사람이 만든 거래의 id, 완전히 지운 id)은 {@code null}이라
 * 응답으로 구분되지 않는다. 컨트롤러가 표시 이름을 붙인 뒤 던진다.
 */
final class TransactionIdConflict extends RuntimeException {

    private final transient TransactionResponse current;

    TransactionIdConflict(TransactionResponse current) {
        super("그 id로는 거래를 만들 수 없다", null, false, false);
        this.current = current;
    }

    /** 쓸 수 없는 id이면 {@code null}이다. */
    TransactionResponse current() {
        return current;
    }
}
