package app.accountbook.account;

public enum AccountType {
    BANK,
    /** 부채 계좌. 결제는 카드 계좌의 지출, 대금 납부는 은행에서 카드로의 이체다. */
    CARD,
    CASH
}
