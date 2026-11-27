package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.HistoryResponse.Change;
import app.accountbook.api.HistoryResponse.Item;
import app.accountbook.api.TransactionResponse.Person;
import app.accountbook.transaction.ChangeAction;
import app.accountbook.transaction.TransactionChange;
import app.accountbook.transaction.TransactionChange.Value;
import app.accountbook.transaction.TransactionStatus;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView.Line;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 이력 응답의 칸 비교(#47, 단식 모양). 스프링과 DB 없이 돈다. 저장과 HTTP는 {@code TransactionHistoryHttpTest}가 본다. */
class HistoryResponseTest {

    private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID LEFT = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
    private static final UUID CASH = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final UUID CARD = UUID.fromString("00000000-0000-0000-0000-0000000000c2");
    private static final UUID FOOD = UUID.fromString("00000000-0000-0000-0000-0000000000f1");
    private static final Map<UUID, String> NAMES = Map.of(OWNER, "소유자");
    private static final Instant AT = Instant.parse("2026-11-24T08:30:43.292603Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);

    @Test
    void 만들기는_값이_있는_칸마다_before가_null이고_사람과_기기와_시각이_붙는다() {
        Item item = item(ChangeAction.CREATE, OWNER, null, expense(CASH, -12_000, null, TransactionStatus.POSTED));

        assertThat(item.actor()).isEqualTo(new Person(OWNER, "소유자"));
        assertThat(item.deviceId()).isEqualTo("iphone.safari");
        assertThat(item.at()).isEqualTo("2026-11-24T08:30:43.292Z");
        assertThat(item.changes()).containsExactly(new Change("type", null, "EXPENSE"),
                new Change("occurredOn", null, "2026-11-18"), new Change("occurredTime", null, "08:05"),
                new Change("accountId", null, CASH.toString()), new Change("categoryId", null, FOOD.toString()),
                new Change("amount", null, 12_000L), new Change("payee", null, "김밥천국"),
                new Change("refund", null, false), new Change("paidBy", null, OWNER.toString()),
                new Change("status", null, "POSTED"));
    }

    @Test
    void 고치기와_취소는_바뀐_칸만이고_지우기와_되살리기는_바뀐_칸이_없다() {
        Value before = expense(CASH, -12_000, null, TransactionStatus.POSTED);

        assertThat(item(ChangeAction.UPDATE, OWNER, before, expense(CARD, 15_000, "환불", TransactionStatus.POSTED))
                .changes()).containsExactly(new Change("accountId", CASH.toString(), CARD.toString()),
                new Change("amount", 12_000L, 15_000L), new Change("memo", null, "환불"),
                new Change("refund", false, true));
        assertThat(item(ChangeAction.CANCEL, OWNER, before, expense(CASH, -12_000, null, TransactionStatus.CANCELED))
                .changes()).containsExactly(new Change("status", "POSTED", "CANCELED"));
        Value trashed = new Value(before.type(), DAY, before.occurredTime(), before.payee(), null, before.status(),
                OWNER, true, before.lines());
        assertThat(item(ChangeAction.DELETE, OWNER, before, trashed).changes()).isEmpty();
        assertThat(item(ChangeAction.RESTORE, OWNER, trashed, before).changes()).isEmpty();
    }

    @Test
    void 이체는_보내고_받는_계좌와_양수_금액이고_라인의_순서는_보지_않는다() {
        Value transfer = transfer(List.of(new Line(CASH, null, -50_000), new Line(CARD, null, 50_000)));

        assertThat(item(ChangeAction.CREATE, OWNER, null, transfer).changes()).containsExactly(
                new Change("type", null, "TRANSFER"), new Change("occurredOn", null, "2026-11-18"),
                new Change("amount", null, 50_000L), new Change("fromAccountId", null, CASH.toString()),
                new Change("toAccountId", null, CARD.toString()), new Change("status", null, "POSTED"));
        assertThat(item(ChangeAction.UPDATE, OWNER, transfer,
                transfer(List.of(new Line(CARD, null, 50_000), new Line(CASH, null, -50_000)))).changes()).isEmpty();
    }

    @Test
    void 바꾼_사람이_비었거나_지금_구성원이_아니면_actor가_null이다() {
        Value value = expense(CASH, -12_000, null, TransactionStatus.POSTED);

        assertThat(item(ChangeAction.CREATE, null, null, value).actor()).isNull();
        assertThat(item(ChangeAction.CREATE, LEFT, null, value).actor()).isNull();
    }

    private static Item item(ChangeAction action, UUID actor, Value before, Value after) {
        return HistoryResponse.of(List.of(new TransactionChange(action, actor, "iphone.safari", AT, before, after)),
                NAMES).items().getFirst();
    }

    private static Value expense(UUID account, long amount, String memo, TransactionStatus status) {
        return new Value(TransactionType.EXPENSE, DAY, LocalTime.of(8, 5, 30), "김밥천국", memo, status, OWNER, false,
                List.of(new Line(account, FOOD, amount)));
    }

    private static Value transfer(List<Line> lines) {
        return new Value(TransactionType.TRANSFER, DAY, null, null, null, TransactionStatus.POSTED, null, false, lines);
    }
}
