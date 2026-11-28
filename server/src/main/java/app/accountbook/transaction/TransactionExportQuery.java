package app.accountbook.transaction;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.ledger.LedgerAccess;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.TypedQuery;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 장부 거래 내보내기(F-701, P-228, #57)가 읽는 거래. 기간은 거래의 날짜(P-202, 입력한 날짜 그대로)이고 양 끝 날을 넣는다.
 * 기간 없이 장부 전체를 읽을 수도 있다(#379). 휴지통의 거래는 빼고 취소한 거래는 넣는다. 순서는 오래된 것부터다: 날짜,
 * 시각(시각 없는 거래가 그날 맨 앞), id. 거래 목록({@link TransactionListQuery})의 순서를 뒤집은 것이다.
 *
 * <p>거래와 라인을 한 문장으로 읽어 한 시점의 내용이다. 엔터티를 올리지 않고 파일에 쓰는 칸만 읽는다. 행 수의 상한은 없다
 * (#57, 받아들인 위험). 장부 조건은 라인과 거래에 각각 건다(docs/db/schema-standards.md 4절, 합계 질의와 같다).
 */
@Component
@Transactional(readOnly = true)
public class TransactionExportQuery {

    /** 장부의 내보낼 라인. 칸의 순서는 {@link ExportedTransaction#of}가 읽는 순서다. */
    private static final String SELECT = """
            select t.id, t.type, t.occurredOn, t.occurredTime, t.payee, t.memo, t.status, t.createdBy,
                   t.refundKind, l.accountId, l.categoryId, l.amount
              from TransactionLine l
              join l.transaction t
             where l.ledgerId = :ledgerId
               and t.ledgerId = :ledgerId
               and t.deletedAt is null
            """;
    /** 같은 거래의 라인은 이어서 온다. 첫 거래의 날짜가 가장 이르고 마지막 거래의 날짜가 가장 늦다. */
    private static final String ORDER = " order by t.occurredOn, t.occurredTime nulls first, t.id, l.id";
    /** 날짜 구간은 {@code >=}와 {@code <}로 쓴다(schema-standards 4절). */
    private static final String PERIOD_LINES = SELECT
            + "   and t.occurredOn >= :from and t.occurredOn < :until\n" + ORDER;
    private static final String ALL_LINES = SELECT + ORDER;

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;

    TransactionExportQuery(EntityManager entityManager, LedgerAccess ledgerAccess) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
    }

    /**
     * 기간의 거래. 구성원 확인이 기간 검사보다 먼저다.
     *
     * @param from 시작일(포함)
     * @param to   종료일(포함). 시작일보다 앞이면 {@code to}의 {@code NOT_ALLOWED}다
     * @return 없으면 빈 목록
     */
    public List<ExportedTransaction> transactions(UUID actorId, UUID ledgerId, LocalDate from, LocalDate to) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (from.isAfter(to)) {
            throw new InvalidRequestException("to", FieldErrorCode.NOT_ALLOWED, "종료일은 시작일과 같거나 뒤여야 합니다.");
        }
        return read(entityManager.createQuery(PERIOD_LINES, Tuple.class)
                .setParameter("from", from)
                .setParameter("until", to.plusDays(1)), ledgerId);
    }

    /**
     * 장부 전체 기간의 거래(#379). 기간 조건만 없고 휴지통·취소·순서와 문장 수는 {@link #transactions}와 같다. 미래 날짜의 거래도
     * 든다.
     *
     * @return 없으면 빈 목록. 있으면 첫 거래와 마지막 거래의 날짜가 가장 이른 날과 가장 늦은 날이다
     */
    public List<ExportedTransaction> allTransactions(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        return read(entityManager.createQuery(ALL_LINES, Tuple.class), ledgerId);
    }

    private static List<ExportedTransaction> read(TypedQuery<Tuple> query, UUID ledgerId) {
        return query.setParameter("ledgerId", ledgerId)
                .getResultList().stream()
                .collect(Collectors.groupingBy(row -> row.get(0, UUID.class), LinkedHashMap::new, Collectors.toList()))
                .values().stream()
                .map(ExportedTransaction::of)
                .toList();
    }
}
