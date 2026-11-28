package app.accountbook.transaction;

import app.accountbook.transaction.TransactionView.Line;
import jakarta.persistence.Tuple;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * 내보내기의 거래 하나({@link TransactionExportQuery}). 사람은 사용자 id이고 이름은 api가 붙인다(ADR 004 결정 6).
 *
 * @param refundKind 지출의 환불 구분(#8). 일반 지출과 수입·이체는 null이다
 * @param lines      분개 라인. 지출·수입은 1줄, 이체는 2줄(보내는 계좌 음수, 받는 계좌 양수)이다(P-203)
 */
public record ExportedTransaction(UUID id, TransactionType type, LocalDate occurredOn, LocalTime occurredTime,
                                  String payee, String memo, TransactionStatus status, UUID createdBy,
                                  RefundKind refundKind, List<Line> lines) {

    /** @param rows 같은 거래의 라인 행. 칸의 순서는 {@code TransactionExportQuery.SELECT}다 */
    static ExportedTransaction of(List<Tuple> rows) {
        Tuple first = rows.getFirst();
        return new ExportedTransaction(first.get(0, UUID.class), first.get(1, TransactionType.class),
                first.get(2, LocalDate.class), first.get(3, LocalTime.class), first.get(4, String.class),
                first.get(5, String.class), first.get(6, TransactionStatus.class), first.get(7, UUID.class),
                first.get(8, RefundKind.class), rows.stream()
                        .map(row -> new Line(row.get(9, UUID.class), row.get(10, UUID.class), row.get(11, Long.class)))
                        .toList());
    }

    /** 로그에 가맹점과 메모가 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "ExportedTransaction[id=" + id + "]";
    }
}
