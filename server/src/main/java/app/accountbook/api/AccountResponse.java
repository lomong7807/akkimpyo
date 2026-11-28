package app.accountbook.api;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 계좌 하나(#13 응답 계약, 목록·추가·수정이 같은 모양). 금액은 부호 있는 정수 원이고 카드의 갚을 금액은 음수다(P-207).
 *
 * @param balance        기준 잔액에 기준일(포함) 이후 거래를 더한 값({@code BalanceQuery})
 * @param openingBalance 저장된 시작 잔액 그대로. 수정 화면이 지금 값을 채운다(#33, #243)
 * @param hidden         숨긴 계좌인가(#43, P-220). 숨긴 계좌는 새 거래에 고를 수 없고 잔액과 통계에는 든다
 */
record AccountResponse(UUID id, String name, AccountType type, long balance, long openingBalance,
                       LocalDate openingDate, boolean hidden) {

    static AccountResponse of(Account account, long balance) {
        return new AccountResponse(account.getId(), account.getName(), account.getType(), balance,
                account.getOpeningBalance(), account.getOpeningDate(), account.isHidden());
    }

    /** 계좌 목록. 숨긴 계좌도 담고 {@code hidden}으로 가른다(F-501). 나누지 않고 전부 담는다(ADR 002 3절). */
    record Items(List<AccountResponse> items) {
    }
}
