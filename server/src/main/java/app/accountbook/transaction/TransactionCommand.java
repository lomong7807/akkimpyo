package app.accountbook.transaction;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/** 거래 생성·수정 요청. 화면은 단식 입력이고, 저장할 때 분개 라인으로 바꾼다. */
public sealed interface TransactionCommand {

    /** 지출 또는 수입 1건. */
    record Entry(UUID id, TransactionType type,      // EXPENSE 또는 INCOME
                 LocalDate occurredOn, LocalTime occurredTime,
                 UUID accountId, UUID categoryId,    // categoryId null이면 미분류
                 long amount,                        // 항상 양수로 받는다
                 RefundKind refundKind,              // EXPENSE에서만 값이 있다. null이면 일반 지출
                 String payee, String memo, UUID paidBy) implements TransactionCommand {
    }

    /** 계좌 간 이체. 라인 2개, 카테고리와 paidBy가 없다. */
    record Transfer(UUID id, LocalDate occurredOn, LocalTime occurredTime,
                    UUID fromAccountId, UUID toAccountId, long amount,
                    String memo) implements TransactionCommand {
    }
}
