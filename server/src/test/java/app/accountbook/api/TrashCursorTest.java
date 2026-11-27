package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import app.accountbook.transaction.TrashPage;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 휴지통의 cursor 글자(#47). 스프링과 DB 없이 돈다. HTTP의 400은 {@code TransactionTrashTest}가 본다. */
class TrashCursorTest {

    private static final UUID LEDGER = UUID.fromString("0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60");
    private static final UUID TX = UUID.fromString("019a5f3e-8b2c-7d4e-9f01-23456789abcd");

    @Test
    void 만든_cursor는_같은_장부에서_같은_키로_읽힌다() {
        for (String at : List.of("2026-11-24T08:30:43.292603Z", "2026-11-24T08:30:43.292Z", "2026-11-30T15:00:00Z")) {
            TrashPage.Key key = new TrashPage.Key(Instant.parse(at), TX);
            String cursor = TrashCursor.encode(LEDGER, key);
            assertThat(cursor).matches("[A-Za-z0-9_-]+").hasSizeLessThan(256);
            assertThat(TrashCursor.decode(cursor, LEDGER)).as(at).contains(key);
        }
    }

    /** 다른 장부의 것, 거래 목록의 것, 모양이 조금이라도 다른 것(다시 쓴 글자와 다른 것)은 읽지 않는다. */
    @Test
    void 이_장부의_휴지통에서_만든_글자가_아니면_읽히지_않는다() {
        String valid = TrashCursor.encode(LEDGER, new TrashPage.Key(Instant.parse("2026-11-24T08:30:43Z"), TX));
        String list = TransactionCursor.encode(LEDGER, new WholeLedger(), new TransactionKey(LocalDate.of(2026, 11, 18),
                null, TX));
        assertThat(TrashCursor.decode(valid, UUID.randomUUID())).isEmpty();
        assertThat(TransactionCursor.decode(valid, LEDGER, new WholeLedger())).as("거래 목록에서").isEmpty();
        List<String> broken = List.of(list, "", "abc", "!!!!", valid + "A", valid + "=", valid.substring(1),
                "A".repeat(300),
                raw("1|" + LEDGER + "|T|2026-11-24T08:30:43Z|" + TX.toString().toUpperCase()),
                raw("1|" + LEDGER + "|T|2026-11-24T08:30:43.000Z|" + TX),       // 다시 쓰면 :43Z
                raw("1|" + LEDGER + "|T|2026-11-24T08:30:43.2926031Z|" + TX),   // 마이크로초보다 잘다
                raw("1|" + LEDGER + "|T|2026-11-24T17:30:43+09:00|" + TX),
                raw("1|" + LEDGER + "|T|+10000-01-01T00:00:00Z|" + TX),         // 네 자리를 넘는 해
                raw("1|" + LEDGER + "|T|2026-11-31T00:00:00Z|" + TX),           // 없는 날
                raw("2|" + LEDGER + "|T|2026-11-24T08:30:43Z|" + TX),
                raw("1|" + LEDGER + "|A|2026-11-24T08:30:43Z|" + TX),
                raw("1|" + LEDGER + "|T|2026-11-24T08:30:43Z"),
                raw("1|" + LEDGER + "|T|2026-11-24T08:30:43Z|" + TX + "|"));
        for (String cursor : broken) {
            assertThat(TrashCursor.decode(cursor, LEDGER)).as(cursor).isEmpty();
        }
    }

    private static String raw(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }
}
