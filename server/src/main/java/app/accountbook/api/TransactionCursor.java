package app.accountbook.api;

import app.accountbook.ledger.LedgerDates;
import app.accountbook.transaction.TransactionFilter;
import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionScope;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import app.accountbook.transaction.TransactionSearch;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 거래 목록의 cursor(#15, ADR 002 3절). 화면은 해석하지 않는 글자다. 받은 장부와 범위, 필터, 그 쪽 마지막 거래의 정렬 키를
 * 담는다. 장부와 범위, 필터는 같은 목록에서 받은 cursor인지 보는 데만 쓰고, 무엇을 볼 수 있는지는 경로와 구성원 확인이 정한다.
 *
 * <p>글자는 {@code 1|장부 id|범위|날짜|시각|거래 id}의 UTF-8을 패딩 없는 base64url로 쓴 것이다. 범위는 달이면
 * {@code M2026-11}, 하루면 {@code D2026-11-18}, 장부 전체면 {@code A}이고, 시각이 없으면 빈 글자다. 필터(#62)가 있으면
 * 끝에 {@code |필터 지문}이 붙는다({@link #fingerprint}). 필터가 없는 cursor는 #15의 글자 그대로다. 읽을 때는 키를 꺼내
 * 이 장부, 이 범위, 이 필터로 다시 써 보고 받은 글자와 같을 때만 받는다. 그래서 다른 장부·다른 범위·다른 필터의 cursor와
 * 한 글자라도 바뀐 cursor는 모두 거절된다.
 *
 * <p>거래 검색(#64)의 cursor도 같은 꼴이다. 범위 자리가 {@code S}이고, 끝의 지문이 늘 붙으며 필터에 기간과 검색어를 더해
 * 만든다({@link #encode(UUID, TransactionSearch, TransactionFilter, TransactionKey)}).
 */
final class TransactionCursor {

    private static final String FORMAT = "1";
    private static final String SEPARATOR = "|";
    private static final String SEARCH = "S";
    /** 만드는 cursor는 150자 안팎이고 필터 지문이 붙어도 175자를 넘지 않는다. 그보다 훨씬 긴 글자는 풀어 보지 않는다. */
    private static final int MAX_LENGTH = 256;
    /** 0~9999년만. 더 큰 해는 DB의 날짜 범위를 넘을 수 있다. */
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private TransactionCursor() {
    }

    static String encode(UUID ledgerId, TransactionScope scope, TransactionFilter filter, TransactionKey key) {
        return encode(ledgerId, label(scope), key,
                filter.equals(TransactionFilter.NONE) ? null : fingerprint(filterText(filter)));
    }

    /** 검색의 cursor. 검색어는 맨 뒤라 검색어에 {@code |}가 있어도 다른 검색과 같은 글자가 되지 않는다. */
    static String encode(UUID ledgerId, TransactionSearch search, TransactionFilter filter, TransactionKey key) {
        return encode(ledgerId, SEARCH, key, fingerprint(String.join(SEPARATOR, filterText(filter),
                Objects.toString(search.from(), ""), Objects.toString(search.to(), ""),
                Objects.toString(search.text(), ""))));
    }

    private static String encode(UUID ledgerId, String label, TransactionKey key, String fingerprint) {
        List<String> parts = new ArrayList<>(List.of(FORMAT, ledgerId.toString(), label,
                key.occurredOn().toString(), key.occurredTime() == null ? "" : key.occurredTime().toString(),
                key.id().toString()));
        if (fingerprint != null) {
            parts.add(fingerprint);
        }
        return ENCODER.encodeToString(String.join(SEPARATOR, parts).getBytes(StandardCharsets.UTF_8));
    }

    /** 이 장부, 이 범위, 이 필터에서 받은 cursor의 키. 망가졌거나 다른 장부·범위·필터의 것이면 비어 있다. */
    static Optional<TransactionKey> decode(String cursor, UUID ledgerId, TransactionScope scope,
                                           TransactionFilter filter) {
        return key(cursor)
                .filter(key -> contains(scope, key.occurredOn()))
                .filter(key -> encode(ledgerId, scope, filter, key).equals(cursor));
    }

    /** 이 장부, 이 검색어·기간·필터에서 받은 검색 cursor의 키. 날짜는 장부 전체의 범위처럼 본다. */
    static Optional<TransactionKey> decode(String cursor, UUID ledgerId, TransactionSearch search,
                                           TransactionFilter filter) {
        return key(cursor)
                .filter(key -> contains(new WholeLedger(), key.occurredOn()))
                .filter(key -> encode(ledgerId, search, filter, key).equals(cursor));
    }

    /**
     * 필터마다 값을 정렬해 이은 글자. 값의 순서와 반복이 달라도 같은 필터면 같다. 카테고리는 하위를 더하기 전의 고른 id다.
     */
    private static String filterText(TransactionFilter filter) {
        return String.join(SEPARATOR, sorted(filter.accountIds()), sorted(filter.categoryIds()),
                sorted(filter.types()), filter.status() == null ? "" : filter.status().name());
    }

    /** 글자의 SHA-256 앞 12바이트(base64url 16자). 비밀이 아니라 첫 쪽과 같은 조건인지 보는 값이다. */
    private static String fingerprint(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return ENCODER.encodeToString(Arrays.copyOf(digest, 12));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("모든 자바 구현에 있어야 하는 SHA-256이 없습니다.", e);
        }
    }

    private static String sorted(Set<?> values) {
        return values.stream().map(Object::toString).sorted().collect(Collectors.joining(","));
    }

    private static Optional<TransactionKey> key(String cursor) {
        if (cursor.length() > MAX_LENGTH) {
            return Optional.empty();
        }
        try {
            String[] parts = new String(DECODER.decode(cursor), StandardCharsets.UTF_8).split(Pattern.quote(SEPARATOR), -1);
            if (parts.length < 6 || parts.length > 7 || !DATE.matcher(parts[3]).matches()) {
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
