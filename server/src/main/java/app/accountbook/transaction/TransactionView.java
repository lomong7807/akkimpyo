package app.accountbook.transaction;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * 거래 1건의 읽기 모델.
 *
 * @param updatedBy 마지막으로 고친 사람(만든 뒤 고친 적이 없으면 만든 사람). 탈퇴로 비워졌으면 null이다(ADR 002 2절)
 * @param deletedAt 휴지통에 넣은 시각. 휴지통이 아니면 null이다
 */
public record TransactionView(
        UUID id,
        UUID ledgerId,
        TransactionType type,
        LocalDate occurredOn,
        LocalTime occurredTime,
        String payee,
        String memo,
        TransactionStatus status,
        UUID createdBy,
        UUID paidBy,
        UUID updatedBy,
        long version,
        Instant deletedAt,
        Instant createdAt,
        Instant updatedAt,
        List<Line> lines) {

    static TransactionView of(Transaction tx, UUID updatedBy) {
        return new TransactionView(
                tx.getId(),
                tx.getLedgerId(),
                tx.getType(),
                tx.getOccurredOn(),
                tx.getOccurredTime(),
                tx.getPayee(),
                tx.getMemo(),
                tx.getStatus(),
                tx.getCreatedBy(),
                tx.getPaidBy(),
                updatedBy,
                tx.getVersion(),
                tx.getDeletedAt(),
                tx.getCreatedAt(),
                tx.getUpdatedAt(),
                tx.getLines().stream().map(Line::of).toList());
    }

    /** 휴지통에 있는가. */
    public boolean deleted() {
        return deletedAt != null;
    }

    /** 분개 라인. amount는 계좌 잔액을 늘리면 양수, 줄이면 음수다. */
    public record Line(UUID accountId, UUID categoryId, long amount) {

        public static Line of(TransactionLine line) {
            return new Line(line.getAccountId(), line.getCategoryId(), line.getAmount());
        }
    }
}
