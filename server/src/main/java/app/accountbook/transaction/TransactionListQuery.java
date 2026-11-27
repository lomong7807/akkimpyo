package app.accountbook.transaction;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.UserText;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.transaction.TransactionPage.DayTotals;
import app.accountbook.transaction.TransactionPage.Totals;
import app.accountbook.transaction.TransactionScope.Day;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import jakarta.persistence.TypedQuery;
import java.math.BigInteger;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BinaryOperator;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 거래 목록(F-215, F-113, F-222, #15). 휴지통의 거래는 빠지고 취소한 거래는 들어간다. 순서는 {@link TransactionKey}이고 요청으로
 * 바꾸지 않는다. 다음 쪽은 OFFSET이 아니라 앞 쪽 마지막 거래의 키 뒤부터 준다. 그사이 거래가 더해지거나 지워져도 이미 받은
 * 거래가 다시 오거나, 받지 않은 거래 가운데 남아 있는 것이 빠지지 않는다.
 *
 * <p>거래와 라인은 한 문장으로 읽는다. 쪽은 하위 질의가 DB에서 자르고, 바깥 질의가 그 거래들과 라인을 함께 읽는다.
 * 라인을 함께 읽는 질의를 메모리에서 자르지 않고(docs/perf/risks.md 2.2), 거래와 라인이 서로 다른 시점의 값이 되지 않는다(#202).
 * 장부 조건은 거래에 건다. 라인은 거래 id로 찾으므로 장부 조건을 더해도 읽는 양이 줄지 않는다({@code findWithLinesById}와 같다).
 *
 * <p>합계({@link TransactionPage#totals()}, {@link TransactionPage#days()})는 P-205이고 DB가 계산한다. 쪽과는 다른
 * 문장이라, 그사이 다른 요청이 고친 거래는 쪽과 합계에 다르게 보일 수 있다.
 *
 * <p>필터({@link TransactionFilter}, #62)는 쪽과 합계에 같이 걸린다. 조건은 {@link #transactionFilter}와
 * {@link #lineFilter}의 고정된 조각에서 고르고 값은 바인딩한다. 쪽은 맞는 라인이 있는 거래를 주고, 합계는 맞는 라인의
 * 금액만 더한다(카테고리 필터의 나눈 거래, F-217).
 *
 * <p>검색({@link #search}, #64)은 같은 쪽과 합계 질의에 검색어 조건({@link SearchMatch})을 더한 것이다.
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

    /**
     * 날마다의 P-205 합계. %s는 날짜 조건이다. 쪽에 나온 날({@link TransactionPage#days()})과 달력의 날짜별 합계
     * ({@link #dailyTotals})가 같이 쓴다. 합계에 드는 라인이 없는 날은 행이 없다.
     */
    private static final String DAY_SUMS = """
            select t.type, cast(sum(l.amount) as BigInteger), t.occurredOn
              from TransactionLine l
              join l.transaction t
             where l.ledgerId = :ledgerId
               and t.ledgerId = :ledgerId
               and %s
               and t.type <> :transfer
               and t.deletedAt is null
               and t.status <> :canceled
             group by t.occurredOn, t.type
            """;

    private static final int MAX_DUPLICATES = 5;

    /** 종료일 없는 검색의 끝. 받는 날짜의 끝(#57, #64)과 같다. */
    private static final LocalDate LAST_DATE = LocalDate.of(9999, 12, 31);

    /**
     * 중복 경고(#59). 남은 %s는 빼는 거래의 조건이다. 장부·날짜 인덱스로 그날의 거래만 읽는다. 지출·수입의 라인은 하나이고
     * 그 금액의 크기가 응답의 {@code amount}다(환불 포함). 자르기와 라인 읽기는 {@link #PAGE}와 같다.
     */
    private static final String DUPLICATES = """
            select t from Transaction t left join fetch t.lines
             where t.ledgerId = :ledgerId
               and t.id in (select d.id from Transaction d join d.lines l
                             where d.ledgerId = :ledgerId
                               and l.ledgerId = :ledgerId
                               and d.occurredOn = :occurredOn
                               and d.type <> :transfer
                               and d.deletedAt is null%s
                               and abs(l.amount) = :amount
                               and %s
                             order by d.createdAt desc, d.id desc
                             limit :size)
             order by t.createdAt desc, t.id desc
            """.formatted("%s", PayeeMatch.sameAs("d.payee"));

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
     * 한 쪽. 구성원 확인이 범위 검사보다 먼저다. 다음 쪽은 첫 쪽과 같은 필터로 부른다(api의 cursor가 확인한다).
     *
     * @param filter 계좌·카테고리가 이 장부에 없으면(다른 장부의 것 포함) 그 입력란({@code accountId},
     *               {@code categoryId})의 {@code NOT_FOUND}다
     * @param after  앞 쪽의 {@link TransactionPage#next()}. 첫 쪽이면 null
     * @param limit  1~{@value #MAX_LIMIT}. 밖이면 {@code limit}의 {@code OUT_OF_RANGE}다
     */
    public TransactionPage page(UUID actorId, UUID ledgerId, TransactionScope scope, TransactionFilter filter,
                                TransactionKey after, int limit) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new InvalidRequestException("limit", FieldErrorCode.OUT_OF_RANGE,
                    "한 번에 1건부터 50건까지 불러올 수 있습니다.");
        }
        DateRange range = range(scope, zoneOf(ledgerId));
        TransactionFilter resolved = resolved(ledgerId, filter);
        List<Transaction> found = find(ledgerId, range, resolved, null, after, limit + 1);
        List<TransactionView> items = views(found.subList(0, Math.min(limit, found.size())));
        Totals totals = after != null || scope instanceof WholeLedger ? null : totals(ledgerId, range, resolved, null);
        return new TransactionPage(items, found.size() > limit ? TransactionKey.of(items.getLast()) : null, totals,
                days(ledgerId, items, resolved));
    }

    /**
     * 거래 검색(F-223, P-232, #64 응답 계약). 검색어({@link SearchMatch}), 기간, 필터에 모두 맞는 거래를 {@link #page}와 같은
     * 순서로 {@value #MAX_LIMIT}건씩 준다. 휴지통의 거래는 빠지고 취소한 거래는 든다. 합계는 첫 쪽에만 있고 조건 전체의
     * P-205다. 날마다 합계는 없다. 기간이 없으면 장부의 모든 날짜(미래 포함)라 장부 전체를 훑을 수 있다(새 인덱스 없음).
     * 구성원 확인이 조건 검사보다 먼저다.
     *
     * @param search 검색어, 기간, 필터가 모두 없으면 {@code q}의 {@code REQUIRED}, 시작일이 종료일보다 뒤면 {@code to}의
     *               {@code NOT_ALLOWED}다
     * @param filter {@link #page}와 같다
     * @param after  앞 쪽의 {@link TransactionPage#next()}. 첫 쪽이면 null
     */
    public TransactionPage search(UUID actorId, UUID ledgerId, TransactionSearch search, TransactionFilter filter,
                                  TransactionKey after) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (search.text() == null && search.from() == null && search.to() == null
                && filter.equals(TransactionFilter.NONE)) {
            throw new InvalidRequestException("q", FieldErrorCode.REQUIRED, "검색어, 기간, 필터 가운데 하나는 있어야 합니다.");
        }
        if (search.from() != null && search.to() != null && search.from().isAfter(search.to())) {
            throw new InvalidRequestException("to", FieldErrorCode.NOT_ALLOWED, "종료일은 시작일과 같거나 뒤여야 합니다.");
        }
        DateRange range = new DateRange(search.from() == null ? LedgerDates.MIN_DATE : search.from(),
                (search.to() == null ? LAST_DATE : search.to()).plusDays(1));
        TransactionFilter resolved = resolved(ledgerId, filter);
        List<Transaction> found = find(ledgerId, range, resolved, search.text(), after, MAX_LIMIT + 1);
        List<TransactionView> items = views(found.subList(0, Math.min(MAX_LIMIT, found.size())));
        return new TransactionPage(items, found.size() > MAX_LIMIT ? TransactionKey.of(items.getLast()) : null,
                after == null ? totals(ledgerId, range, resolved, search.text()) : null, List.of());
    }

    /**
     * 달력의 날짜별 합계(F-222, #66 응답 계약). 그 달에서 합계에 드는 거래가 있는 날만 날짜 순으로 주고, 이체·취소·휴지통
     * 거래만 있는 날은 없다. 날마다의 값은 {@link TransactionPage#days()}와 같은 문장으로 세므로 같은 날이면 같다. 날짜는
     * 거래의 날짜 그대로다. 구성원 확인이 달 검사보다 먼저고, 달의 범위는 {@link #page}의 달과 같다.
     *
     * @param month 없으면 {@code month}의 {@code REQUIRED}다
     */
    public List<DayTotals> dailyTotals(UUID actorId, UUID ledgerId, YearMonth month) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (month == null) {
            throw new InvalidRequestException("month", FieldErrorCode.REQUIRED, "조회할 달이 없습니다.");
        }
        DateRange range = range(new Month(month), zoneOf(ledgerId));
        Map<LocalDate, Map<TransactionType, Long>> sums = daySums(entityManager.createQuery(
                        DAY_SUMS.formatted("t.occurredOn >= :from and t.occurredOn < :until"), Tuple.class)
                .setParameter("from", range.from())
                .setParameter("until", range.until()), ledgerId, TransactionFilter.NONE);
        return sums.keySet().stream().sorted().map(date -> dayTotals(date, sums)).toList();
    }

    /**
     * 중복 경고(P-218, F-209, #59 응답 계약). 같은 장부에서 날짜, 금액, 가맹점({@link PayeeMatch})이 모두 같은 지출·수입을
     * 저장한 시각이 늦은 것부터 {@value #MAX_DUPLICATES}건까지 준다. 저장한 시각이 같으면 id가 큰 것이 먼저다. 다른 구성원이
     * 넣은 거래도 들고, 휴지통의 거래는 빠지며 취소한 거래는 든다. 이체는 가맹점이 없어 대상이 아니다. 조회만 한다.
     * 구성원 확인이 금액과 가맹점 검사보다 먼저다. 날짜의 범위는 보지 않는다(저장이 따로 본다).
     *
     * @param amount  화면이 입력한 크기. 거래 만들기와 같은 범위 밖이면 {@code amount}의 {@code OUT_OF_RANGE}다
     * @param payee   비었거나 공백류뿐이면 결과가 없다. 길거나 쓸 수 없는 글자는 저장할 때와 같은 {@code payee}의 오류다
     * @param exclude 결과에서 뺄 거래(수정 저장에서 그 거래 자신). 없으면 null
     */
    public List<TransactionView> duplicates(UUID actorId, UUID ledgerId, LocalDate occurredOn, long amount,
                                            String payee, UUID exclude) {
        ledgerAccess.requireMember(actorId, ledgerId);
        TransactionLimits.requireAmountInRange(amount);
        String normalized = UserText.payee(payee, TransactionService.PAYEE_MAX_LENGTH);
        if (normalized == null) {
            return List.of();
        }
        TypedQuery<Transaction> query = entityManager.createQuery(
                        DUPLICATES.formatted(exclude == null ? "" : " and d.id <> :exclude"), Transaction.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("occurredOn", occurredOn)
                .setParameter("transfer", TransactionType.TRANSFER)
                .setParameter("amount", amount)
                .setParameter("size", MAX_DUPLICATES);
        PayeeMatch.bind(query, normalized);
        if (exclude != null) {
            query.setParameter("exclude", exclude);
        }
        // 라인을 함께 읽어 거래 하나가 라인 수만큼의 행으로 온다. 같은 거래는 같은 객체다.
        return views(query.getResultList().stream().distinct().toList());
    }

    /** 범위 전체에서 필터와 검색어(목록이면 null)에 맞는 라인의 P-205 합계. */
    private Totals totals(UUID ledgerId, DateRange range, TransactionFilter filter, String text) {
        Map<TransactionType, Long> sums = sums(SearchMatch.bind(entityManager.createQuery("""
                        select t.type, cast(sum(l.amount) as BigInteger)
                          from TransactionLine l
                          join l.transaction t
                         where l.ledgerId = :ledgerId
                           and t.ledgerId = :ledgerId
                           and t.occurredOn >= :from and t.occurredOn < :until%s
                           and t.type <> :transfer
                           and t.deletedAt is null
                           and t.status <> :canceled
                         group by t.type
                        """.formatted(sumFilter(filter) + SearchMatch.condition(text, "t")), Tuple.class), text)
                .setParameter("from", range.from())
                .setParameter("until", range.until()), ledgerId, filter).stream()
                .collect(Collectors.toMap(row -> row.get(0, TransactionType.class), TransactionListQuery::sum));
        return new Totals(sums.getOrDefault(TransactionType.INCOME, 0L),
                expense(sums.getOrDefault(TransactionType.EXPENSE, 0L)));
    }

    /** 이 쪽에 나온 날마다 그날 전체에서 필터에 맞는 P-205 합계. 한 날이 두 쪽에 걸쳐도 같은 값이다. 쪽마다 한 문장이다. */
    private List<DayTotals> days(UUID ledgerId, List<TransactionView> items, TransactionFilter filter) {
        List<LocalDate> dates = items.stream().map(TransactionView::occurredOn).distinct().toList();
        if (dates.isEmpty()) {
            return List.of();
        }
        Map<LocalDate, Map<TransactionType, Long>> sums = daySums(entityManager.createQuery(
                        DAY_SUMS.formatted("t.occurredOn in :dates" + sumFilter(filter)), Tuple.class)
                .setParameter("dates", dates), ledgerId, filter);
        return dates.stream().map(date -> dayTotals(date, sums)).toList();
    }

    /** {@link #DAY_SUMS}의 행을 날짜와 종류로 묶은 합. */
    private static Map<LocalDate, Map<TransactionType, Long>> daySums(TypedQuery<Tuple> query, UUID ledgerId,
                                                                       TransactionFilter filter) {
        return sums(query, ledgerId, filter).stream()
                .collect(Collectors.groupingBy(row -> row.get(2, LocalDate.class),
                        Collectors.toMap(row -> row.get(0, TransactionType.class), TransactionListQuery::sum)));
    }

    /** 그날의 합계. 합계에 드는 라인이 없는 날은 0이다. */
    private static DayTotals dayTotals(LocalDate date, Map<LocalDate, Map<TransactionType, Long>> sums) {
        Map<TransactionType, Long> day = sums.getOrDefault(date, Map.of());
        return new DayTotals(date, day.getOrDefault(TransactionType.INCOME, 0L),
                expense(day.getOrDefault(TransactionType.EXPENSE, 0L)));
    }

    /**
     * 합계 질의의 공통 조건 값. 라인과 거래에 장부 조건을 각각 건다(docs/db/schema-standards.md 4절). 수입·지출 구분은
     * 카테고리가 아니라 거래 종류로 한다. 서비스가 카테고리의 구분을 종류와 맞추므로 월 통계(MonthlyStatsQuery)와 같은 값이다.
     */
    private static List<Tuple> sums(TypedQuery<Tuple> query, UUID ledgerId, TransactionFilter filter) {
        return bind(query, filter).setParameter("ledgerId", ledgerId)
                .setParameter("transfer", TransactionType.TRANSFER)
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getResultList();
    }

    /** DB의 합은 numeric이라 넘치지 않는다. long을 넘으면 틀린 값 대신 ArithmeticException이 난다(BalanceQuery와 같다). */
    private static long sum(Tuple row) {
        return row.get(1, BigInteger.class).longValueExact();
    }

    /** 지출 라인은 음수이고 환불 라인은 양수라, 합의 부호를 뒤집으면 환불을 뺀 지출이다. */
    private static long expense(long lineSum) {
        return Math.negateExact(lineSum);
    }

    /** 범위의 날짜 구간. 끝은 들지 않는다. */
    private DateRange range(TransactionScope scope, ZoneId ledgerZone) {
        return switch (scope) {
            case Month month -> {
                LedgerDates.requireMonthInRange("month", month.month(), clock, ledgerZone);
                yield new DateRange(month.month().atDay(1), month.month().plusMonths(1).atDay(1));
            }
            case Day day -> {
                LedgerDates.requireInRange("date", "날짜는", day.date(), clock, ledgerZone);
                yield new DateRange(day.date(), day.date().plusDays(1));
            }
            case WholeLedger wholeLedger ->
                    new DateRange(LedgerDates.MIN_DATE, LedgerDates.today(clock, ledgerZone).plusDays(1));
        };
    }

    /** @param text 검색어. 목록이면 null */
    private List<Transaction> find(UUID ledgerId, DateRange range, TransactionFilter filter, String text,
                                   TransactionKey after, int size) {
        String next = after == null ? "" : after.occurredTime() == null ? AFTER_UNTIMED : AFTER_TIMED;
        TypedQuery<Transaction> query = SearchMatch.bind(bind(entityManager.createQuery(
                PAGE.formatted(pageFilter(filter) + SearchMatch.condition(text, "p") + next), Transaction.class),
                filter), text)
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
     * 필터의 계좌와 카테고리가 이 장부의 것인지 보고, 고른 상위 카테고리에 그 하위를 더한 필터. 다른 장부의 id는 없는 id와
     * 같은 오류다. 숨긴 계좌도 받는다. 카테고리는 2단계까지라(P-221) 하위의 하위는 없다. 고른 것이 없으면 읽지 않는다.
     */
    private TransactionFilter resolved(UUID ledgerId, TransactionFilter filter) {
        List<InvalidRequestException> errors = new ArrayList<>();
        if (!filter.accountIds().isEmpty() && !inLedger(
                "select a.id from Account a where a.ledgerId = :ledgerId and a.id in :ids",
                ledgerId, filter.accountIds()).containsAll(filter.accountIds())) {
            errors.add(new InvalidRequestException("accountId", FieldErrorCode.NOT_FOUND, "장부에 없는 계좌입니다."));
        }
        Set<UUID> categoryIds = filter.categoryIds().isEmpty() ? Set.of() : inLedger(
                "select c.id from Category c where c.ledgerId = :ledgerId and (c.id in :ids or c.parentId in :ids)",
                ledgerId, filter.categoryIds());
        if (!categoryIds.containsAll(filter.categoryIds())) {
            errors.add(new InvalidRequestException("categoryId", FieldErrorCode.NOT_FOUND, "장부에 없는 카테고리입니다."));
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new TransactionFilter(filter.accountIds(), categoryIds, filter.types(), filter.status());
    }

    private Set<UUID> inLedger(String jpql, UUID ledgerId, Set<UUID> ids) {
        return Set.copyOf(entityManager.createQuery(jpql, UUID.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("ids", ids)
                .getResultList());
    }

    /**
     * 쪽의 하위 질의(거래 {@code p})에 더하는 필터 조건. 라인 조건은 거래 id로 라인을 찾는 exists라 이체의 두 라인이 모두
     * 맞아도 거래는 한 번 나온다. 라인에 장부 조건을 걸지 않는 까닭은 {@link #PAGE}의 라인 읽기와 같다.
     */
    private static String pageFilter(TransactionFilter filter) {
        String line = lineFilter(filter, "fl");
        return transactionFilter(filter, "p") + (line.isEmpty() ? ""
                : " and exists (select fl.id from TransactionLine fl where fl.transaction = p" + line + ")");
    }

    /** 합계 질의(라인 {@code l}, 거래 {@code t})에 더하는 필터 조건. 맞는 라인의 금액만 더한다. */
    private static String sumFilter(TransactionFilter filter) {
        return transactionFilter(filter, "t") + lineFilter(filter, "l");
    }

    /** 거래에 거는 조각. alias는 이 클래스의 질의에 있는 이름이고, 사용자 값은 조각에 들지 않는다. */
    private static String transactionFilter(TransactionFilter filter, String alias) {
        return (filter.types().isEmpty() ? "" : " and " + alias + ".type in :types")
                + (filter.status() == null ? "" : " and " + alias + ".status = :status");
    }

    /** 라인에 거는 조각. 계좌와 카테고리는 한 라인이 둘 다 맞아야 한다. */
    private static String lineFilter(TransactionFilter filter, String alias) {
        return (filter.accountIds().isEmpty() ? "" : " and " + alias + ".accountId in :accountIds")
                + (filter.categoryIds().isEmpty() ? "" : " and " + alias + ".categoryId in :categoryIds");
    }

    /** 조각에 쓴 이름에만 값을 넣는다. */
    private static <T extends TypedQuery<?>> T bind(T query, TransactionFilter filter) {
        if (!filter.types().isEmpty()) {
            query.setParameter("types", filter.types());
        }
        if (filter.status() != null) {
            query.setParameter("status", filter.status());
        }
        if (!filter.accountIds().isEmpty()) {
            query.setParameter("accountIds", filter.accountIds());
        }
        if (!filter.categoryIds().isEmpty()) {
            query.setParameter("categoryIds", filter.categoryIds());
        }
        return query;
    }

    /** 읽은 순서 그대로의 읽기 모델. 고친 사람은 {@link #lastEdits}다. */
    private List<TransactionView> views(List<Transaction> txs) {
        Map<UUID, Edit> edits = lastEdits(txs);
        return txs.stream()
                .map(tx -> TransactionView.of(tx, Optional.ofNullable(edits.get(tx.getId()))
                        .map(Edit::actorId)
                        .orElse(null)))
                .toList();
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
