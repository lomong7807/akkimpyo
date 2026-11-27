package app.accountbook.api;

import app.accountbook.ledger.LedgerDates;
import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionScope;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 거래 목록의 cursor(#15, ADR 002 3절). 화면은 해석하지 않는 글자다. 받은 장부와 범위, 그 쪽 마지막 거래의 정렬 키를 담는다.
 * 장부와 범위는 같은 목록에서 받은 cursor인지 보는 데만 쓰고, 무엇을 볼 수 있는지는 경로와 구성원 확인이 정한다.
 *
 * <p>글자는 {@code 1|장부 id|범위|날짜|시각|거래 id}의 UTF-8을 패딩 없는 base64url로 쓴 것이다. 범위는 달이면
 * {@code M2026-11}, 하루면 {@code D2026-11-18}, 장부 전체면 {@code A}이고, 시각이 없으면 빈 글자다. 읽을 때는 키를 꺼내
 * 이 장부, 이 범위로 다시 써 보고 받은 글자와 같을 때만 받는다. 그래서 다른 장부·다른 범위의 cursor와 한 글자라도 바뀐
 * cursor는 모두 거절된다.
 */
final class TransactionCursor {

    private static final String FORMAT = "1";
    private static final String SEPARATOR = "|";
    /** 만드는 cursor는 150자 안팎이다. 그보다 훨씬 긴 글자는 풀어 보지 않는다. */
    private static final int MAX_LENGTH = 256;
    /** 0~9999년만. 더 큰 해는 DB의 날짜 범위를 넘을 수 있다. */
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private TransactionCursor() {
    }

    static String encode(UUID ledgerId, TransactionScope scope, TransactionKey key) {
        String text = String.join(SEPARATOR, FORMAT, ledgerId.toString(), label(scope), key.occurredOn().toString(),
                key.occurredTime() == null ? "" : key.occurredTime().toString(), key.id().toString());
        return ENCODER.encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    /** 이 장부, 이 범위에서 받은 cursor의 키. 망가졌거나 다른 장부·다른 범위의 것이면 비어 있다. */
    static Optional<TransactionKey> decode(String cursor, UUID ledgerId, TransactionScope scope) {
        return key(cursor)
                .filter(key -> contains(scope, key.occurredOn()))
                .filter(key -> encode(ledgerId, scope, key).equals(cursor));
    }

    private static Optional<TransactionKey> key(String cursor) {
        if (cursor.length() > MAX_LENGTH) {
            return Optional.empty();
        }
        try {
            String[] parts = new String(DECODER.decode(cursor), StandardCharsets.UTF_8).split(Pattern.quote(SEPARATOR), -1);
            if (parts.length != 6 || !DATE.matcher(parts[3]).matches()) {
                return Optional.empty();
            }
            return Optional.of(new TransactionKey(LocalDate.parse(parts[3]),
                    parts[4].isEmpty() ? null : LocalTime.parse(parts[4]), UUID.fromString(parts[5])));
        } catch (IllegalArgumentException | DateTimeException e) {
            return Optional.empty();
        }
    }

    private static String label(TransactionScope scope) {
        return switch (scope) {
            case Month month -> "M" + month.month();
            case Day day -> "D" + day.date();
            case WholeLedger wholeLedger -> "A";
        };
    }

    /** 그 범위의 목록에 나올 수 있는 날짜인가. 장부 전체의 위쪽 끝(오늘)은 서비스의 범위가 정한다. */
    private static boolean contains(TransactionScope scope, LocalDate date) {
        return switch (scope) {
            case Month month -> YearMonth.from(date).equals(month.month());
            case Day day -> date.equals(day.date());
            case WholeLedger wholeLedger -> !date.isBefore(LedgerDates.MIN_DATE);
        };
    }
}
