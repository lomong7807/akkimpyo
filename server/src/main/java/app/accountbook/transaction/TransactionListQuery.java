package app.accountbook.transaction;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.TypedQuery;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BinaryOperator;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 거래 목록(F-215, F-113, #15). 휴지통의 거래는 빠지고 취소한 거래는 들어간다. 순서는 {@link TransactionKey}이고 요청으로
 * 바꾸지 않는다. 다음 쪽은 OFFSET이 아니라 앞 쪽 마지막 거래의 키 뒤부터 준다. 그사이 거래가 더해지거나 지워져도 이미 받은
 * 거래가 다시 오거나, 받지 않은 거래 가운데 남아 있는 것이 빠지지 않는다.
 *
 * <p>거래와 라인은 한 문장으로 읽는다. 쪽은 하위 질의가 DB에서 자르고, 바깥 질의가 그 거래들과 라인을 함께 읽는다.
 * 라인을 함께 읽는 질의를 메모리에서 자르지 않고(docs/perf/risks.md 2.2), 거래와 라인이 서로 다른 시점의 값이 되지 않는다(#202).
 * 장부 조건은 거래에 건다. 라인은 거래 id로 찾으므로 장부 조건을 더해도 읽는 양이 줄지 않는다({@code findWithLinesById}와 같다).
 */
@Component
@Transactional(readOnly = true)
public class TransactionListQuery {

    /** 한 쪽의 최대 건수이자 기본 건수(P-232). */
    public static final int MAX_LIMIT = 50;

    /** %s는 다음 쪽 조건이다. 하위 질의(자르기)와 바깥 질의(내보내기)의 정렬이 같다. */
    private static final String PAGE = """
            select t from Transaction t left join fetch t.lines
             where t.ledgerId = :ledgerId
               and t.id in (select p.id from Transaction p
                             where p.ledgerId = :ledgerId
                               and p.deletedAt is null
                               and p.occurredOn >= :from and p.occurredOn < :until%s
                             order by p.occurredOn desc, p.occurredTime desc nulls last, p.id desc
                             limit :size)
             order by t.occurredOn desc, t.occurredTime desc nulls last, t.id desc
            """;

    /**
     * 시각 있는 거래의 뒤: 앞 날짜, 또는 같은 날의 더 이른 시각, 시각 없는 거래, 같은 시각의 더 작은 id.
     * 시각이 null일 수 있어 행 비교 한 줄로 쓰지 않는다(docs/perf/risks.md 2.3). 날짜의 상한은 인덱스 범위를 좁힌다.
     */
    private static final String AFTER_TIMED = " and p.occurredOn <= :afterOn"
            + " and (p.occurredOn < :afterOn or p.occurredTime < :afterTime or p.occurredTime is null"
            + " or (p.occurredTime = :afterTime and p.id < :afterId))";

    /** 시각 없는 거래의 뒤: 앞 날짜, 또는 같은 날의 시각 없는 거래 가운데 더 작은 id. */
    private static final String AFTER_UNTIMED = " and p.occurredOn <= :afterOn"
            + " and (p.occurredOn < :afterOn or (p.occurredTime is null and p.id < :afterId))";

    private final EntityManager entityManager;
    private final LedgerAccess ledgerAccess;
    private final LedgerRepository ledgerRepository;
    private final Clock clock;

    TransactionListQuery(EntityManager entityManager, LedgerAccess ledgerAccess, LedgerRepository ledgerRepository,
                         Clock clock) {
        this.entityManager = entityManager;
        this.ledgerAccess = ledgerAccess;
        this.ledgerRepository = ledgerRepository;
        this.clock = clock;
    }

    /**
     * 한 쪽. 구성원 확인이 범위 검사보다 먼저다.
     *
     * @param after 앞 쪽의 {@link TransactionPage#next()}. 첫 쪽이면 null
     * @param limit 1~{@value #MAX_LIMIT}. 밖이면 {@code limit}의 {@code OUT_OF_RANGE}다
     */
    public TransactionPage page(UUID actorId, UUID ledgerId, TransactionScope scope, TransactionKey after, int limit) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new InvalidRequestException("limit", FieldErrorCode.OUT_OF_RANGE,
                    "한 번에 1건부터 50건까지 불러올 수 있습니다.");
        }
        DateRange range = range(scope, zoneOf(ledgerId));
        List<Transaction> found = find(ledgerId, range, after, limit + 1);
        List<Transaction> shown = found.subList(0, Math.min(limit, found.size()));
        Map<UUID, Edit> edits = lastEdits(shown);
        List<TransactionView> items = shown.stream()
                .map(tx -> TransactionView.of(tx, Optional.ofNullable(edits.get(tx.getId()))
                        .map(Edit::actorId)
                        .orElse(null)))
                .toList();
        return new TransactionPage(items, found.size() > limit ? TransactionKey.of(items.getLast()) : null);
    }

    /** 범위의 날짜 구간. 끝은 들지 않는다. */
    private DateRange range(TransactionScope scope, ZoneId ledgerZone) {
        return switch (scope) {
            case Month month -> {
                LedgerDates.requireMonthInRange("month", month.month(), clock, ledgerZone);
                yield new DateRange(month.month().atDay(1), month.month().plusMonths(1).atDay(1));
            }
            case WholeLedger wholeLedger ->
                    new DateRange(LedgerDates.MIN_DATE, LedgerDates.today(clock, ledgerZone).plusDays(1));
        };
    }

    private List<Transaction> find(UUID ledgerId, DateRange range, TransactionKey after, int size) {
        String next = after == null ? "" : after.occurredTime() == null ? AFTER_UNTIMED : AFTER_TIMED;
        TypedQuery<Transaction> query = entityManager.createQuery(PAGE.formatted(next), Transaction.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("from", range.from())
                .setParameter("until", range.until())
                .setParameter("size", size);
        if (after != null) {
            query.setParameter("afterOn", after.occurredOn()).setParameter("afterId", after.id());
            if (after.occurredTime() != null) {
                query.setParameter("afterTime", after.occurredTime());
            }
        }
        // 라인을 함께 읽어 거래 하나가 라인 수만큼의 행으로 온다. 같은 거래는 같은 객체다.
        return query.getResultList().stream().distinct().toList();
    }

    /**
     * 거래마다 읽은 version까지의 마지막 이력(고친 사람, ADR 002 2절). {@code TransactionService}가 거래 하나에 쓰는
     * 규칙과 같고, 쪽마다 한 문장으로 읽는다. 이력은 거래 id로 찾으므로 장부 조건을 걸지 않는다(schema-standards 4절).
     */
    private Map<UUID, Edit> lastEdits(List<Transaction> txs) {
        if (txs.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Long> versions = txs.stream().collect(Collectors.toMap(Transaction::getId, Transaction::getVersion));
        return entityManager.createQuery("""
                        select c.transactionId, c.version, c.actorId from ChangeLog c
                         where c.transactionId in :ids
                        """, Tuple.class)
                .setParameter("ids", versions.keySet())
                .getResultList().stream()
                .map(row -> new Edit(row.get(0, UUID.class), row.get(1, Long.class), row.get(2, UUID.class)))
                .filter(edit -> edit.version() <= versions.get(edit.transactionId()))
                .collect(Collectors.toMap(Edit::transactionId, Function.identity(),
                        BinaryOperator.maxBy(Comparator.comparingLong(Edit::version))));
    }

    private ZoneId zoneOf(UUID ledgerId) {
        return ledgerRepository.findById(ledgerId).map(Ledger::zoneId).orElseThrow(NotFoundException::new);
    }

    private record DateRange(LocalDate from, LocalDate until) {
    }

    /** @param actorId 탈퇴로 비워졌으면 null */
    private record Edit(UUID transactionId, long version, UUID actorId) {
    }
}
