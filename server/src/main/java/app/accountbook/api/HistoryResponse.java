package app.accountbook.api;

import app.accountbook.api.TransactionResponse.Person;
import app.accountbook.transaction.ChangeAction;
import app.accountbook.transaction.TransactionChange;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView.Line;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 거래의 변경 이력(#47 응답 계약). 오래된 것부터다(F-228). 전후 값은 거래 API(#14)와 같은 단식 모양으로 바꾼 뒤 칸마다 비교해, 바뀐 칸만
 * {@code changes}에 넣는다. 칸 이름과 값의 모양은 {@link TransactionResponse}와 같다(금액은 양수 정수, 계좌·카테고리·사람은
 * id, 시각은 {@code HH:mm}). 만들기는 값이 있는 칸마다 {@code before}가 null이고, 지우기·되살리기는 {@code action}이 알리므로
 * 바뀐 칸이 없다.
 */
record HistoryResponse(List<Item> items) {

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    /** @param names 장부 구성원의 표시 이름({@code UserService.memberDisplayNames}) */
    static HistoryResponse of(List<TransactionChange> history, Map<UUID, String> names) {
        return new HistoryResponse(history.stream()
                .map(change -> new Item(change.action(), Person.of(change.actorId(), names), change.deviceId(),
                        TransactionResponse.serverTime(change.at()), changes(change)))
                .toList());
    }

    private static List<Change> changes(TransactionChange change) {
        Map<String, Object> before = fields(change.before());
        Map<String, Object> after = fields(change.after());
        List<Change> changes = new ArrayList<>();
        after.forEach((field, value) -> {
            if (!Objects.equals(before.get(field), value)) {
                changes.add(new Change(field, before.get(field), value));
            }
        });
        return changes;
    }

    /** {@link TransactionResponse#of}와 같은 규칙으로 단식 모양의 칸을 늘어놓는다. 값이 없으면 모든 칸이 null이다. */
    private static Map<String, Object> fields(TransactionChange.Value value) {
        boolean known = value != null;
        boolean transfer = known && value.type() == TransactionType.TRANSFER;
        Line entry = known && !transfer ? value.lines().getFirst() : null;
        Line from = transfer ? line(value, false) : null;
        Line to = transfer ? line(value, true) : null;
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("type", known ? value.type().name() : null);
        fields.put("occurredOn", known ? value.occurredOn().toString() : null);
        fields.put("occurredTime", known && value.occurredTime() != null ? TIME.format(value.occurredTime()) : null);
        fields.put("accountId", entry == null ? null : text(entry.accountId()));
        fields.put("categoryId", entry == null ? null : text(entry.categoryId()));
        fields.put("amount", !known ? null : transfer ? (Object) to.amount() : (Object) Math.abs(entry.amount()));
        fields.put("payee", entry == null ? null : value.payee());
        fields.put("memo", known ? value.memo() : null);
        fields.put("refundKind", known && value.refundKind() != null ? value.refundKind().name() : null);
        fields.put("paidBy", entry == null ? null : text(value.paidBy()));
        fields.put("fromAccountId", from == null ? null : text(from.accountId()));
        fields.put("toAccountId", to == null ? null : text(to.accountId()));
        fields.put("status", known ? value.status().name() : null);
        return fields;
    }

    /** 이체의 라인: 받는 계좌는 잔액이 늘어 양수, 보내는 계좌는 음수다. */
    private static Line line(TransactionChange.Value value, boolean incoming) {
        return value.lines().stream().filter(line -> line.amount() > 0 == incoming).findFirst().orElseThrow();
    }

    private static String text(UUID id) {
        return id == null ? null : id.toString();
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "HistoryResponse[]";
    }

    /**
     * @param actor    바꾼 사람. 서버가 한 일, 탈퇴한 사람, 지금 장부의 구성원이 아닌 사람은 null이다
     * @param deviceId 저장된 기기 값 그대로(예: {@code iphone.safari}, {@code unknown}). 화면이 이름으로 바꾼다(D-07)
     * @param at       기록한 시각(ADR 002 2절의 서버 시각)
     */
    record Item(ChangeAction action, Person actor, String deviceId, String at, List<Change> changes) {

        @Override
        public String toString() {
            return "Item[" + action + "]";
        }
    }

    /** @param before 바뀌기 전 값. 값이 없었으면 null이다 */
    record Change(String field, Object before, Object after) {

        @Override
        public String toString() {
            return "Change[" + field + "]";
        }
    }
}
