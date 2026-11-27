package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionScope;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.Base64;
import java.util.List;
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
                String cursor = TransactionCursor.encode(LEDGER, scope, key);
                assertThat(cursor).matches("[A-Za-z0-9_-]+").hasSizeLessThan(256);
                assertThat(TransactionCursor.decode(cursor, LEDGER, scope)).as(scope + " " + key).contains(key);
            }
        }
    }

    @Test
    void 다른_장부_다른_범위의_cursor는_읽히지_않는다() {
        TransactionKey key = new TransactionKey(DAY, LocalTime.of(8, 5), TX);
        String month = TransactionCursor.encode(LEDGER, NOVEMBER, key);
        String whole = TransactionCursor.encode(LEDGER, new WholeLedger(), key);

        assertThat(TransactionCursor.decode(month, OTHER_LEDGER, NOVEMBER)).isEmpty();
        assertThat(TransactionCursor.decode(month, LEDGER, new Month(YearMonth.of(2026, 10)))).isEmpty();
        assertThat(TransactionCursor.decode(month, LEDGER, new WholeLedger())).isEmpty();
        assertThat(TransactionCursor.decode(month, LEDGER, new Day(DAY))).isEmpty();
        assertThat(TransactionCursor.decode(whole, LEDGER, NOVEMBER)).isEmpty();
        assertThat(TransactionCursor.decode(TransactionCursor.encode(LEDGER, new Day(DAY), key), LEDGER,
                new Day(DAY.plusDays(1)))).isEmpty();
    }

    /** 키가 범위 밖이거나, 모양이 조금이라도 다르면(다시 쓴 글자와 다르면) 읽지 않는다. */
    @Test
    void 망가진_cursor는_읽히지_않는다() {
        String valid = TransactionCursor.encode(LEDGER, NOVEMBER, new TransactionKey(DAY, null, TX));
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
            assertThat(TransactionCursor.decode(cursor, LEDGER, NOVEMBER)).as(cursor).isEmpty();
        }
        assertThat(TransactionCursor.decode(raw("1|" + LEDGER + "|A|1999-12-31||" + TX), LEDGER, new WholeLedger()))
                .as("2000-01-01 전").isEmpty();
        assertThat(TransactionCursor.decode(raw("1|" + LEDGER + "|A|+10000-01-01||" + TX), LEDGER,
                new WholeLedger())).as("네 자리를 넘는 해").isEmpty();
    }

    private static String raw(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    private static String flip(String text, int at) {
        char c = text.charAt(at);
        return text.substring(0, at) + (c == 'A' ? 'B' : 'A') + text.substring(at + 1);
    }
}
