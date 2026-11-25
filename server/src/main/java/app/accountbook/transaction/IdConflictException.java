package app.accountbook.transaction;

import java.util.Optional;

/**
 * 그 id로는 거래를 만들 수 없다(ADR 006 결정 3). 아무것도 저장하지 않는다.
 * {@link #current()}가 있으면 내가 만든 거래와 내용이 다른 것이고, 없으면 그 id를 쓸 수 없다는 것뿐이다.
 */
public class IdConflictException extends RuntimeException {

    private final TransactionView current;

    private IdConflictException(String message, TransactionView current) {
        super(message);
        this.current = current;
    }

    /** 같은 장부에서 내가 만든 거래가 같은 id로 있고 내용이 다르다. 저장된 거래를 담는다. */
    static IdConflictException differentContent(TransactionView current) {
        return new IdConflictException("같은 id의 다른 거래가 이미 있습니다.", current);
    }

    /**
     * 다른 장부의 id, 다른 사람이 만든 거래의 id, 완전히 지운 거래의 id다.
     * 이유를 구분할 수 없게 문구가 고정이고 아무 값도 담지 않는다. 이유가 늘어도 이것을 쓴다.
     */
    static IdConflictException unusableId() {
        return new IdConflictException("이 id는 쓸 수 없습니다.", null);
    }

    /** 화면이 내 입력과 나란히 보여 줄 저장된 거래. 쓸 수 없는 id이면 비어 있다. */
    public Optional<TransactionView> current() {
        return Optional.ofNullable(current);
    }
}
