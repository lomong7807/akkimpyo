package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.transaction.TransactionStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.math.BigInteger;
import java.time.Clock;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 월별 수입·지출과 최상위 카테고리별 합계(F-301, P-205). 대상은 occurred_on이 그 달이고, 삭제·취소되지 않았으며,
 * 카테고리가 있는(= 이체가 아닌) 라인이다. 계좌 기준일과 무관하다. 하위 카테고리의 라인은 상위 카테고리에 더한다.
 * 카테고리별 합계는 DB가 계산한다. 합계가 long을 넘으면 틀린 값 대신 {@link ArithmeticException}이 난다
 * (BigInteger로 읽는 이유는 {@link BalanceQuery}).
 *
 * <p>달의 범위와 구간 조건은 거래 목록(#15)·날짜별 합계(#66)와 같다. 라인과 거래에 장부 조건을 각각 건다
 * (docs/db/schema-standards.md 4절). 카테고리에는 걸지 않는다(같은 절의 예외). 걸면 계획기가 카테고리를 한 행으로 보고
 * 카테고리부터 읽어, 그 카테고리의 라인을 모든 달에 걸쳐 읽는다(TransactionListPlanTest에서 큰 장부의 라인 2만 건 전부, #16).
 * 걸지 않으면 그 달의 라인마다 카테고리를 기본 키로 찾는다.
 */
@Component
@Transactional(readOnly = true)
public class MonthlyStatsQuery {

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;
    private final LedgerRepository ledgerRepository;
    private final Clock clock;

    MonthlyStatsQuery(EntityManager entityManager, LedgerAccess ledgerAccess, LedgerRepository ledgerRepository,
                      Clock clock) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
        this.ledgerRepository = ledgerRepository;
        this.clock = clock;
    }

    /**
     * 구성원 확인이 달 검사보다 먼저다.
     *
     * @param month 없으면 {@code month}의 {@code REQUIRED}, 범위 밖이면 {@code OUT_OF_RANGE}다(#15와 같다)
     */
    public MonthlySummary monthly(UUID actorId, UUID ledgerId, YearMonth month) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (month == null) {
            throw new InvalidRequestException("month", FieldErrorCode.REQUIRED, "조회할 달이 없습니다.");
        }
        LedgerDates.requireMonthInRange("month", month, clock,
                ledgerRepository.findById(ledgerId).map(Ledger::zoneId).orElseThrow(NotFoundException::new));
        return MonthlySummary.of(entityManager.createQuery("""
                        select coalesce(c.parentId, c.id), c.kind, cast(sum(l.amount) as BigInteger)
                          from TransactionLine l
                          join l.transaction t
                          join Category c on c.id = l.categoryId
                         where l.ledgerId = :ledgerId
                           and t.ledgerId = :ledgerId
                           and t.occurredOn >= :from and t.occurredOn < :until
                           and t.deletedAt is null
                           and t.status <> :canceled
                         group by coalesce(c.parentId, c.id), c.kind
                        having sum(l.amount) <> 0
                        """, Tuple.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("from", month.atDay(1))
                .setParameter("until", month.plusMonths(1).atDay(1))
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getResultList().stream()
                .map(row -> CategoryTotal.of(row.get(0, UUID.class), row.get(1, CategoryKind.class),
                        row.get(2, BigInteger.class).longValueExact()))
                .sorted(Comparator.comparing(CategoryTotal::kind)
                        .thenComparing(CategoryTotal::total, Comparator.reverseOrder()))
                .toList());
    }
}
