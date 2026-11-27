package app.accountbook.api;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 계좌 하나(#13 응답 계약). 잔액은 부호 있는 정수 원이고 카드의 갚을 금액은 음수다(P-207). 시작 잔액은 넣지 않는다.
 *
 * @param balance 기준 잔액에 기준일(포함) 이후 거래를 더한 값({@code BalanceQuery})
 */
record AccountResponse(UUID id, String name, AccountType type, long balance, LocalDate openingDate) {

    static AccountResponse of(Account account, long balance) {
        return new AccountResponse(account.getId(), account.getName(), account.getType(), balance,
                account.getOpeningDate());
    }

    /** 계좌 목록. 나누지 않고 전부 담는다(ADR 002 3절). */
    record Items(List<AccountResponse> items) {
    }
}
