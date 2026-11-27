package app.accountbook.transaction;

import app.accountbook.common.UserText;
import jakarta.persistence.Query;
import java.math.BigInteger;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * 거래가 검색어에 맞는다는 조건(P-232, F-223, #64). 가맹점/내용이나 메모에 검색어가 들어 있으면(부분 일치, 대소문자 무시)
 * 맞고, 검색어가 금액으로 읽히면({@link #amount}) 라인 금액의 크기가 그 금액인 거래도 맞는다(또는). 대소문자는 양쪽 모두
 * DB의 {@code lower}로 바꾼다({@link PayeeMatch}와 같은 까닭).
 *
 * <p>검색어는 LIKE 패턴 안에서 글자 그대로다. 이스케이프 글자는 {@code !}이고 {@code !}, {@code %}, {@code _}를 이스케이프한다.
 * 이스케이프 글자가 역슬래시가 아니라서 {@code \}도 보통 글자다(JPQL 문자열 상수에 역슬래시를 쓰지 않으려고 골랐다).
 * 값은 바인딩하고 조각에는 alias와 고정된 글자만 든다.
 */
final class SearchMatch {

    private static final Pattern DIGITS = Pattern.compile("[0-9]+");
    private static final String WON = "원";

    private SearchMatch() {
    }

    /** {@code alias} 거래가 검색어에 맞는다는 조각. 검색어가 없으면 빈 글자다. 값은 {@link #bind}로 넣는다. */
    static String condition(String text, String alias) {
        if (text == null) {
            return "";
        }
        String amount = amount(text).isEmpty() ? "" : " or exists (select sl.id from TransactionLine sl"
                + " where sl.transaction = " + alias + " and abs(sl.amount) = :searchAmount)";
        return " and (lower(" + alias + ".payee) like lower(:pattern) escape '!'"
                + " or lower(" + alias + ".memo) like lower(:pattern) escape '!'" + amount + ")";
    }

    /** {@link #condition}에 쓴 이름에만 값을 넣는다. */
    static <T extends Query> T bind(T query, String text) {
        if (text != null) {
            query.setParameter("pattern", "%" + text.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%");
            amount(text).ifPresent(amount -> query.setParameter("searchAmount", amount));
        }
        return query;
    }

    /**
     * 검색어가 뜻하는 금액. 쉼표를 모두 떼고 끝의 "원"과 그 앞의 공백류를 뗀 나머지가 숫자뿐이고, 거래 금액의 범위
     * ({@link TransactionLimits})이면 그 값이다. 예: {@code 12000}, {@code 12,000}, {@code 12000원}, {@code 12,000 원}.
     */
    static Optional<Long> amount(String text) {
        String number = text.replace(",", "");
        if (number.endsWith(WON)) {
            int end = number.length() - WON.length();
            while (end > 0 && UserText.TRIMMED_SPACES.indexOf(number.charAt(end - 1)) >= 0) {
                end--;
            }
            number = number.substring(0, end);
        }
        if (!DIGITS.matcher(number).matches()) {
            return Optional.empty();
        }
        BigInteger value = new BigInteger(number);
        boolean inRange = value.compareTo(BigInteger.valueOf(TransactionLimits.MIN_AMOUNT)) >= 0
                && value.compareTo(BigInteger.valueOf(TransactionLimits.MAX_AMOUNT)) <= 0;
        return inRange ? Optional.of(value.longValueExact()) : Optional.empty();
    }
}
