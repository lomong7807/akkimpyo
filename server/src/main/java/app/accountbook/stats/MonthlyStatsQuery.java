package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.transaction.TransactionStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 월별 수입·지출과 카테고리별 합계. 대상은 occurred_on이 그 달이고, 삭제·취소되지 않았으며,
 * 카테고리가 있는(= 이체가 아닌) 라인이다. 계좌 기준일과 무관하다. 카테고리별 합계는 DB가 계산한다.
 */
@Component
@Transactional(readOnly = true)
public class MonthlyStatsQuery {

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;

    MonthlyStatsQuery(EntityManager entityManager, LedgerAccess ledgerAccess) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
    }

    public MonthlySummary monthly(UUID actorId, UUID ledgerId, YearMonth month) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (month == null) {
            throw new InvalidRequestException("조회할 달이 없습니다.");
        }
        return MonthlySummary.of(entityManager.createQuery("""
                        select l.categoryId, c.kind, sum(l.amount)
                          from TransactionLine l
                          join l.transaction t
                          join Category c on c.id = l.categoryId
                         where t.ledgerId = :ledgerId
                           and t.occurredOn between :firstDay and :lastDay
                           and t.deletedAt is null
                           and t.status <> :canceled
                         group by l.categoryId, c.kind
                        having sum(l.amount) <> 0
                        """, Tuple.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("firstDay", month.atDay(1))
                .setParameter("lastDay", month.atEndOfMonth())
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getResultList().stream()
                .map(row -> CategoryTotal.of(row.get(0, UUID.class), row.get(1, CategoryKind.class),
                        row.get(2, Long.class)))
                .sorted(Comparator.comparing(CategoryTotal::kind)
                        .thenComparing(CategoryTotal::total, Comparator.reverseOrder()))
                .toList());
    }
}
