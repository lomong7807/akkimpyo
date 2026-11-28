package app.accountbook.api;

import app.accountbook.transaction.RefundKind;
import app.accountbook.transaction.TransactionStatus;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView;
import app.accountbook.transaction.TransactionView.Line;
import app.accountbook.transaction.TrashAutoPurge;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.UUID;

/**
 * 거래 하나(#14 응답 계약). 요청과 같은 단식 모양에 서버 값을 더한다. 금액은 늘 양수이고 방향은 종류와
 * {@code refundKind}, 이체의 두 계좌로 나타낸다. 그 종류의 모양에 없는 칸은 {@code null}이다(지출·수입의
 * {@code fromAccountId}·{@code toAccountId}, 이체의 {@code accountId}·{@code categoryId}·{@code payee}·{@code paidBy}).
 * 사람은 {@code {id, displayName}}이고 지금 장부의 구성원이 아니면(탈퇴) {@code null}이다.
 *
 * @param occurredTime 사용자가 고른 {@code HH:mm}. 시각 없음이면 {@code null}
 * @param categoryId   저장된 값이다. 미분류로 보냈으면 미분류 카테고리의 id다
 * @param refundKind   저장된 환불 구분(#8, #102 계약). 일반 지출과 수입·이체는 {@code null}
 * @param purgeAt      휴지통 거래가 영구 삭제 대상이 되는 시각({@code deletedAt} + 30일). 실제 삭제는 최대 하루 늦다(#9)
 */
record TransactionResponse(UUID id, TransactionType type, LocalDate occurredOn, String occurredTime,
                           UUID accountId, UUID categoryId, long amount, String payee, String memo, RefundKind refundKind,
                           Person paidBy, UUID fromAccountId, UUID toAccountId, TransactionStatus status,
                           long version, String createdAt, Person createdBy, String updatedAt, Person updatedBy,
                           String deletedAt, String purgeAt) {

    /** 휴지통에 두는 기간(IA 5절 1번). */
    static final Duration TRASH_RETENTION = TrashAutoPurge.RETENTION;

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");
    /** 서버가 기록한 시각: ISO 8601, UTC, 밀리초 3자리 고정(ADR 002 2절). */
    private static final DateTimeFormatter SERVER_TIME =
            DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    /** @param names 장부 구성원의 표시 이름({@code UserService.memberDisplayNames}) */
    static TransactionResponse of(TransactionView tx, Map<UUID, String> names) {
        boolean transfer = tx.type() == TransactionType.TRANSFER;
        Line entry = transfer ? null : tx.lines().getFirst();
        Line from = transfer ? line(tx, false) : null;
        Line to = transfer ? line(tx, true) : null;
        return new TransactionResponse(tx.id(), tx.type(), tx.occurredOn(),
                tx.occurredTime() == null ? null : TIME.format(tx.occurredTime()),
                transfer ? null : entry.accountId(), transfer ? null : entry.categoryId(),
                transfer ? to.amount() : Math.abs(entry.amount()),
                transfer ? null : tx.payee(), tx.memo(),
                tx.refundKind(),
                transfer ? null : Person.of(tx.paidBy(), names),
                transfer ? from.accountId() : null, transfer ? to.accountId() : null,
                tx.status(), tx.version(), serverTime(tx.createdAt()), Person.of(tx.createdBy(), names),
                serverTime(tx.updatedAt()), Person.of(tx.updatedBy(), names), serverTime(tx.deletedAt()),
                tx.deletedAt() == null ? null : serverTime(tx.deletedAt().plus(TRASH_RETENTION)));
    }

    /** 이체의 라인: 받는 계좌는 잔액이 늘어 양수, 보내는 계좌는 음수다. */
    private static Line line(TransactionView tx, boolean incoming) {
        return tx.lines().stream().filter(line -> line.amount() > 0 == incoming).findFirst().orElseThrow();
    }

    static String serverTime(Instant at) {
        return at == null ? null : SERVER_TIME.format(at);
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionResponse[]";
    }

    /** 거래에 남은 사람. 이름은 api가 응답을 만들 때 붙인다(ADR 002 2절). */
    record Person(UUID id, String displayName) {

        static Person of(UUID userId, Map<UUID, String> names) {
            return userId == null || !names.containsKey(userId) ? null : new Person(userId, names.get(userId));
        }

        /** 스프링이 응답 객체를 로그에 남길 때 이름이 나가지 않게 한다(ADR 001 결정 10). */
        @Override
        public String toString() {
            return "Person[]";
        }
    }
}
