package app.accountbook.transaction;

/** 같은 id의 거래가 이미 있는데 내용이나 장부가 다르다. 재전송이 아니므로 거부한다. */
public class IdConflictException extends RuntimeException {

    public IdConflictException() {
        super("같은 id의 다른 거래가 이미 있습니다.");
    }
}
