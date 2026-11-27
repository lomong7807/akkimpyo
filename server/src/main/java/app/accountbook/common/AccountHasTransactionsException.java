package app.accountbook.common;

/** 계좌를 쓰는 거래가 있어 지울 수 없다(F-508). 휴지통과 취소한 거래, 이체의 받는 쪽도 센다. */
public class AccountHasTransactionsException extends InUseException {

    public AccountHasTransactionsException() {
        super("거래가 있는 계좌는 지울 수 없습니다.");
    }
}
