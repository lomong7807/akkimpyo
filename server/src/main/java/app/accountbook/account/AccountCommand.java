package app.accountbook.account;

import java.time.LocalDate;

/**
 * 계좌 생성·수정 요청. openingBalance는 음수를 허용한다(카드 부채, 마이너스 통장). 크기는 9,999,999,999원까지다.
 * 값이 모두 있어야 한다. 없는 값(null)은 서비스가 그 입력란의 {@code REQUIRED}로 거부한다.
 */
public record AccountCommand(String name, AccountType type, Long openingBalance, LocalDate openingDate) {

    public AccountCommand(String name, AccountType type, long openingBalance, LocalDate openingDate) {
        this(name, type, Long.valueOf(openingBalance), openingDate);
    }
}
