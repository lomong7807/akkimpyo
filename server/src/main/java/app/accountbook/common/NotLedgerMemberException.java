package app.accountbook.common;

/** 호출자가 장부 구성원이 아니다. 장부가 없는 경우도 같은 예외로 알려 존재 여부를 드러내지 않는다. */
public class NotLedgerMemberException extends RuntimeException {

    public NotLedgerMemberException() {
        super("장부 구성원이 아닙니다.");
    }
}
