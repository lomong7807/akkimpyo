package app.accountbook.api;

import static app.accountbook.transaction.TransactionFilter.NONE;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.transaction.TransactionFilter;
import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionScope;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import app.accountbook.transaction.TransactionStatus;
import app.accountbook.transaction.TransactionType;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** cursor 글자(#15). 스프링과 DB 없이 돈다. HTTP의 400은 {@code TransactionListTest}가 본다. */
class TransactionCursorTest {

    private static final UUID LEDGER = UUID.fromString("0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60");
    private static final UUID OTHER_LEDGER = UUID.fromString("1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
    private static final UUID TX = UUID.fromString("019a5f3e-8b2c-7d4e-9f01-23456789abcd");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final Month NOVEMBER = new Month(YearMonth.of(2026, 11));

    @Test
    void 만든_cursor는_같은_장부_같은_범위에서_같은_키로_읽힌다() {
        List<TransactionKey> keys = List.of(new TransactionKey(DAY, LocalTime.of(8, 5), TX),
                new TransactionKey(DAY, null, TX), new TransactionKey(DAY, LocalTime.of(23, 59, 59, 999_000_000), TX));
        for (TransactionScope scope : List.of(NOVEMBER, new Day(DAY), new WholeLedger())) {
            for (TransactionKey key : keys) {
                String cursor = TransactionCursor.encode(LEDGER, scope, NONE, key);
                assertThat(cursor).matches("[A-Za-z0-9_-]+").hasSizeLessThan(256);
                assertThat(TransactionCursor.decode(cursor, LEDGER, scope, NONE)).as(scope + " " + key).contains(key);
            }
        }
    }

    @Test
    void 다른_장부_다른_범위의_cursor는_읽히지_않는다() {
        TransactionKey key = new TransactionKey(DAY, LocalTime.of(8, 5), TX);
        String month = TransactionCursor.encode(LEDGER, NOVEMBER, NONE, key);
        String whole = TransactionCursor.encode(LEDGER, new WholeLedger(), NONE, key);

        assertThat(TransactionCursor.decode(month, OTHER_LEDGER, NOVEMBER, NONE)).isEmpty();
        assertThat(TransactionCursor.decode(month, LEDGER, new Month(YearMonth.of(2026, 10)), NONE)).isEmpty();
        assertThat(TransactionCursor.decode(month, LEDGER, new WholeLedger(), NONE)).isEmpty();
        assertThat(TransactionCursor.decode(month, LEDGER, new Day(DAY), NONE)).isEmpty();
        assertThat(TransactionCursor.decode(whole, LEDGER, NOVEMBER, NONE)).isEmpty();
        assertThat(TransactionCursor.decode(TransactionCursor.encode(LEDGER, new Day(DAY), NONE, key), LEDGER,
                new Day(DAY.plusDays(1)), NONE)).isEmpty();
    }

    /** 키가 범위 밖이거나, 모양이 조금이라도 다르면(다시 쓴 글자와 다르면) 읽지 않는다. */
    @Test
    void 망가진_cursor는_읽히지_않는다() {
        String valid = TransactionCursor.encode(LEDGER, NOVEMBER, NONE, new TransactionKey(DAY, null, TX));
        List<String> broken = List.of("", "abc", "!!!!", valid + "A", valid + "=", valid.substring(1),
                flip(valid, valid.length() / 2), "A".repeat(300),
                raw("1|" + LEDGER + "|M2026-11|2026-10-31||" + TX),       // 그 달 밖의 날짜
                raw("1|" + LEDGER + "|M2026-11|2026-11-18|08:05:00|" + TX), // 초가 0인데 적은 시각
                raw("1|" + LEDGER + "|M2026-11|2026-11-18||" + TX.toString().toUpperCase()),
                raw("1|" + LEDGER + "|M2026-11|2026-11-31||" + TX),       // 없는 날
                raw("2|" + LEDGER + "|M2026-11|2026-11-18||" + TX),
                raw("1|" + LEDGER + "|M2026-11|2026-11-18|" + TX),
                raw("1|" + LEDGER + "|M2026-11|2026-11-18||" + TX + "|"));
        for (String cursor : broken) {
            assertThat(TransactionCursor.decode(cursor, LEDGER, NOVEMBER, NONE)).as(cursor).isEmpty();
        }
        assertThat(TransactionCursor.decode(raw("1|" + LEDGER + "|A|1999-12-31||" + TX), LEDGER, new WholeLedger(),
                NONE)).as("2000-01-01 전").isEmpty();
        assertThat(TransactionCursor.decode(raw("1|" + LEDGER + "|A|+10000-01-01||" + TX), LEDGER,
                new WholeLedger(), NONE)).as("네 자리를 넘는 해").isEmpty();
    }

    /** 필터(#62)가 있으면 지문이 붙고, 같은 필터에서만 읽힌다. 필터가 없으면 #15의 글자 그대로다. */
    @Test
    void 필터의_cursor는_같은_필터에서만_읽힌다() {
        TransactionKey key = new TransactionKey(DAY, LocalTime.of(23, 59, 59, 999_000_000), TX);
        TransactionFilter filter = new TransactionFilter(Set.of(LEDGER, OTHER_LEDGER), Set.of(TX),
                Set.of(TransactionType.EXPENSE, TransactionType.TRANSFER), TransactionStatus.POSTED);
        String cursor = TransactionCursor.encode(LEDGER, new Day(DAY), filter, key);

        assertThat(cursor).matches("[A-Za-z0-9_-]+").hasSizeLessThan(176);
        assertThat(TransactionCursor.decode(cursor, LEDGER, new Day(DAY), new TransactionFilter(Set.of(OTHER_LEDGER,
                LEDGER), Set.of(TX), Set.of(TransactionType.TRANSFER, TransactionType.EXPENSE),
                TransactionStatus.POSTED))).contains(key);
        assertThat(TransactionCursor.encode(LEDGER, NOVEMBER, NONE, key))
                .isEqualTo(raw("1|" + LEDGER + "|M2026-11|2026-11-18|23:59:59.999|" + TX));
        for (TransactionFilter other : List.of(NONE,
                new TransactionFilter(Set.of(LEDGER), Set.of(TX), filter.types(), TransactionStatus.POSTED),
                new TransactionFilter(filter.accountIds(), Set.of(), filter.types(), TransactionStatus.POSTED),
                new TransactionFilter(filter.accountIds(), Set.of(TX), Set.of(), TransactionStatus.POSTED),
                new TransactionFilter(filter.accountIds(), Set.of(TX), filter.types(), TransactionStatus.CANCELED),
                new TransactionFilter(filter.accountIds(), Set.of(TX), filter.types(), null),
                new TransactionFilter(Set.of(TX), filter.accountIds(), filter.types(), TransactionStatus.POSTED))) {
            assertThat(TransactionCursor.decode(cursor, LEDGER, new Day(DAY), other)).as(other.toString()).isEmpty();
        }
        assertThat(TransactionCursor.decode(TransactionCursor.encode(LEDGER, new Day(DAY), NONE, key), LEDGER,
                new Day(DAY), filter)).as("필터 없이 받은 cursor").isEmpty();
    }

    private static String raw(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    private static String flip(String text, int at) {
        char c = text.charAt(at);
        return text.substring(0, at) + (c == 'A' ? 'B' : 'A') + text.substring(at + 1);
    }
}
