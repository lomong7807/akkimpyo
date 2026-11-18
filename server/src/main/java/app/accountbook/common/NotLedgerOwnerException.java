package app.accountbook.common;

/** 호출자가 장부의 OWNER가 아니다. */
public class NotLedgerOwnerException extends RuntimeException {

    public NotLedgerOwnerException() {
        super("장부 소유자만 할 수 있습니다.");
    }
}
