package app.accountbook.transaction;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/** 거래 1건의 읽기 모델. */
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
        long version,
        boolean deleted,
        Instant createdAt,
        Instant updatedAt,
        List<Line> lines) {

    public static TransactionView of(Transaction tx) {
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
                tx.getVersion(),
                tx.isDeleted(),
                tx.getCreatedAt(),
                tx.getUpdatedAt(),
                tx.getLines().stream().map(Line::of).toList());
    }

    /** 분개 라인. amount는 계좌 잔액을 늘리면 양수, 줄이면 음수다. */
    public record Line(UUID accountId, UUID categoryId, long amount) {

        public static Line of(TransactionLine line) {
            return new Line(line.getAccountId(), line.getCategoryId(), line.getAmount());
        }
    }
}
