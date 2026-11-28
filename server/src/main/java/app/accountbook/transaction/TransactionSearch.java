package app.accountbook.transaction;

import java.time.LocalDate;

/**
 * 거래 검색의 검색어와 기간(F-223, P-232, #64). 필터는 거래 목록과 같은 {@link TransactionFilter}로 따로 받는다.
 *
 * @param text api가 가맹점/내용을 저장할 때처럼 맞춘 검색어. 없으면 null
 * @param from 시작일(포함). null이면 앞쪽을 제한하지 않는다
 * @param to   종료일(포함). null이면 뒤쪽을 제한하지 않는다(미래 날짜도 든다)
 */
public record TransactionSearch(String text, LocalDate from, LocalDate to) {

    /** 검색어의 최대 글자 수(코드포인트). 가맹점/내용과 같다. */
    public static final int MAX_TEXT_LENGTH = TransactionService.PAYEE_MAX_LENGTH;
}
