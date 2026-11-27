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
import java.time.Month;
import java.time.Year;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 연 단위 통계(F-304, P-224). 대상 라인과 규칙은 월별 통계({@link MonthlyStatsQuery})와 같고 범위만 그해 1월 1일부터
 * 다음 해 1월 1일 앞까지다. 장부 시간대의 날짜인 occurred_on으로 나누므로 12월 31일은 그해, 1월 1일은 다음 해다.
 *
 * <p>그해의 라인을 한 문장으로 달·라인의 카테고리별로 묶어 읽는다(달마다 따로 묻지 않는다). 연 합계와 그해의 카테고리별
 * 합계(하위별 금액 포함)는 그 결과를 더해 만든다. 라인과 거래에 장부 조건을 각각 걸고 카테고리에는 걸지 않는 까닭은 월별
 * 통계와 같다. 거래는 장부·날짜 인덱스로 그해만 읽는다(TransactionListPlanTest).
 */
@Component
@Transactional(readOnly = true)
public class YearlyStatsQuery {

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;
    private final LedgerRepository ledgerRepository;
    private final Clock clock;

    YearlyStatsQuery(EntityManager entityManager, LedgerAccess ledgerAccess, LedgerRepository ledgerRepository,
                     Clock clock) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
        this.ledgerRepository = ledgerRepository;
        this.clock = clock;
    }

    /**
     * 구성원 확인이 해 검사보다 먼저다.
     *
     * @param year 없으면 {@code year}의 {@code REQUIRED}다. 2000년부터 장부 시간대로 오늘로부터 1년 뒤의 날이 속한 해까지
     *             (월별 통계가 볼 수 있는 달이 하나라도 든 해, 양 끝 포함)가 아니면 {@code year}의 {@code OUT_OF_RANGE}다
     */
    public YearlySummary yearly(UUID actorId, UUID ledgerId, Year year) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (year == null) {
            throw new InvalidRequestException("year", FieldErrorCode.REQUIRED, "조회할 해가 없습니다.");
        }
        requireInRange(year,
                ledgerRepository.findById(ledgerId).map(Ledger::zoneId).orElseThrow(NotFoundException::new));
        Map<Month, List<CategoryTotal>> byMonth = entityManager.createQuery("""
                        select extract(month from t.occurredOn), coalesce(c.parentId, c.id), c.id, c.kind,
                               cast(sum(l.amount) as BigInteger)
                          from TransactionLine l
                          join l.transaction t
                          join Category c on c.id = l.categoryId
                         where l.ledgerId = :ledgerId
                           and t.ledgerId = :ledgerId
                           and t.occurredOn >= :from and t.occurredOn < :until
                           and t.deletedAt is null
                           and t.status <> :canceled
                         group by extract(month from t.occurredOn), c.parentId, c.id, c.kind
                        having sum(l.amount) <> 0
                        """, Tuple.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("from", year.atDay(1))
                .setParameter("until", year.plusYears(1).atDay(1))
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getResultList().stream()
                .collect(Collectors.groupingBy(row -> Month.of(row.get(0, Number.class).intValue()),
                        Collectors.mapping(row -> CategoryTotal.ofLine(row.get(1, UUID.class), row.get(2, UUID.class),
                                row.get(3, CategoryKind.class), row.get(4, BigInteger.class).longValueExact()),
                                Collectors.toList())));
        return YearlySummary.of(year, byMonth);
    }

    /** 월별 통계의 달 범위({@link LedgerDates#requireMonthInRange})의 달이 하나라도 든 해. 오류 문구에 입력값을 넣지 않는다. */
    private void requireInRange(Year year, ZoneId ledgerZone) {
        if (year.isBefore(Year.from(LedgerDates.MIN_DATE))
                || year.isAfter(Year.from(LedgerDates.today(clock, ledgerZone).plusYears(1)))) {
            throw new InvalidRequestException("year", FieldErrorCode.OUT_OF_RANGE,
                    "해는 2000년부터 오늘로부터 1년 뒤의 해까지 볼 수 있습니다.");
        }
    }
}
