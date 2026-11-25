package app.accountbook.account;

import java.time.LocalDate;

/** 계좌 생성·수정 요청. openingBalance는 음수를 허용한다(카드 부채, 마이너스 통장). 크기는 9,999,999,999원까지다. */
public record AccountCommand(String name, AccountType type, long openingBalance, LocalDate openingDate) {
}
