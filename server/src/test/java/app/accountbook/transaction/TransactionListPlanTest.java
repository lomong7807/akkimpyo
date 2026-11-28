package app.accountbook.transaction;

import static java.util.stream.Collectors.joining;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.stats.MonthlyStatsQuery;
import app.accountbook.stats.YearlyStatsQuery;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.Year;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 거래 목록의 쪽 질의가 장부 크기에 비례해 읽지 않는다(#15, docs/db/schema-standards.md 4절). 장부 1,000개가 섞인 DB의
 * 큰 장부(거래 2만 건, 10년치)에서 앱이 보낸 문장을 그 값 그대로 {@code EXPLAIN (ANALYZE, BUFFERS)}로 본다.
 * 계획을 흔들리지 않게 하는 방법은 {@code LookupIndexPlanTest}와 같다: 고정 id를 SQL로 만들고, 테이블마다 3만 행 이하라
 * ANALYZE가 모든 행을 읽으며, ANALYZE를 테스트 트랜잭션 안에서 한다. 계획은 "[plan] " 줄로 빌드 로그에 남는다.
 */
@IntegrationTest
@Import(StoppedClockConfig.class)
class TransactionListPlanTest {

    private static final int LEDGERS = 1_000;
    /** 큰 장부(1번)의 거래 수. 2026-11-27부터 3,650일 앞까지 고르게, 넷에 하나는 시각 없음. */
    private static final int BIG = 20_000;
    /** 나머지 장부마다의 거래 수. 큰 장부와 같은 10년에 흩어 둔다. 한 달에 몰면 날짜 통계가 운영과 달라진다. */
    private static final int SMALL = 10;

    private static final int USER = 1;
    private static final int LEDGER = 2;
    private static final int MEMBER = 3;
    private static final int ACCOUNT = 4;
    private static final int CATEGORY = 5;
    private static final int TRANSACTION = 6;
    private static final int LINE = 7;

    private static final UUID BIG_OWNER = id(USER, 1);
    private static final UUID BIG_LEDGER = id(LEDGER, 1);
    private static final String INDEX_BACKWARD = "Index Scan Backward using ix_transaction_ledger_occurred_on";
    /**
     * 그 달의 거래(약 160건)와 라인을 잇는 계획은 이 데이터에서 둘로 갈린다. 거래마다 라인을 거래 id의 인덱스로 찾는
     * Nested Loop(비용 약 1,480)와 라인 테이블(약 3만 행)을 통째로 읽는 Hash Join(약 1,365)의 비용이 비슷해, 통계와 행 수가
     * 같아도 앞선 테스트가 넣고 지운 라인의 빈자리로 라인 테이블의 쪽 수가 달라지면(CI에서 462쪽과 1,387쪽) 계획이 바뀐다.
     * 운영 크기에서는 라인 테이블이 커서 Nested Loop다(큰 데이터의 확인은 #171). 그래서 이 노드만 읽은 행 상한에서 뺀다.
     */
    private static final String LINE_SEQ_SCAN = "Seq Scan on transaction_line";
    /**
     * 연 단위 통계의 읽은 행 상한은 거래 테이블을 훑은 노드(Seq Scan, Index Scan, Bitmap Heap Scan)만 센다. 그해의 거래
     * 2,190건과 잇는 쪽은 이 데이터에서 테이블을 통째로 읽는다: CI에서 라인은 Hash Join의 Seq Scan(장부의 2만 행),
     * 카테고리는 Seq Scan(테스트 DB 전체의 카테고리)이었다. 운영 크기에서는 라인 테이블이 커서 Nested Loop다(#171).
     * Bitmap Index Scan도 세지 않는다. 그 rows는 이 클래스의 앞선 테스트가 같은 id로 넣고 되돌린 거래의 인덱스 항목까지 들어
     * 테스트 순서에 따라 바뀐다(CI에서 2,190건의 4배인 8,760). 라인을 카테고리 인덱스로 읽는 계획(#16이 막은 것)은 따로 막는다.
     */
    private static final Predicate<String> ON_TRANSACTION_TABLE = line -> line.contains(" on transaction ");
    private static final Pattern BIND = Pattern.compile("binding parameter \\((\\d+):[^)]*\\) <- \\[(.*)]");
    private static final AtomicInteger PREPARED = new AtomicInteger();

    @Autowired TransactionListQuery listQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired YearlyStatsQuery yearlyStatsQuery;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;

    // 진단(머지하지 않는다): main CI에서 둘째 경우부터 한 경우가 60초 걸린 곳을 찾는다.
    private static volatile String step = "";
    private static volatile long stepStarted;
    private static volatile Thread worker;
    private static volatile long afterEachAt;
    private static Thread watchdog;

    @AfterEach
    void markAfterEach() {
        afterEachAt = System.nanoTime();
    }

    @BeforeEach
    void seedManyLedgersAndAnalyze() {
        if (afterEachAt != 0) {
            System.out.printf("[plan] 진단 앞 경우 끝에서 이 준비까지: %d ms%n", (System.nanoTime() - afterEachAt) / 1_000_000);
        }
        startWatchdog();
        print("진단 표 상태", jdbc.queryForList("""
                select relname, n_live_tup, n_dead_tup, autovacuum_count, autoanalyze_count,
                       pg_relation_size(relid) / 8192 as pages
                from pg_stat_user_tables
                where relname in ('users', 'ledger', 'ledger_member', 'account', 'category', 'transaction',
                                  'transaction_line')
                order by relname
                """).stream().map(Object::toString).toList());
        lap("시드 전체", this::seed);
    }

    private void seed() {
        clock.stopAt(Instant.parse("2026-11-27T03:00:00Z"));
        lap("시드 users", () -> jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                select %s, 'list-plan-' || g || '@example.com', 'hash', 'u' || g, now() from generate_series(1, %d) g
                """.formatted(idSql(USER, "g"), LEDGERS)));
        lap("시드 ledger", () -> jdbc.update(
                "insert into ledger (id, name, created_at) select %s, 'l' || g, now() from generate_series(1, %d) g"
                .formatted(idSql(LEDGER, "g"), LEDGERS)));
        lap("시드 ledger_member", () -> jdbc.update("""
                insert into ledger_member (id, ledger_id, user_id, role, created_at)
                select %s, %s, %s, 'OWNER', now() from generate_series(1, %d) g
                """.formatted(idSql(MEMBER, "g"), idSql(LEDGER, "g"), idSql(USER, "g"), LEDGERS)));
        lap("시드 account", () -> jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
                select %s, %s, 'a', 'BANK', 0, date '2016-01-01', now() from generate_series(1, %d) g
                """.formatted(idSql(ACCOUNT, "g"), idSql(LEDGER, "g"), LEDGERS)));
        lap("시드 category", () -> jdbc.update("""
                insert into category (id, ledger_id, kind, name, parent_id, system, created_at)
                select %s, %s, 'EXPENSE', 'c', null, false, now() from generate_series(1, %d) g
                """.formatted(idSql(CATEGORY, "g"), idSql(LEDGER, "g"), LEDGERS)));
        // 거래 번호 n: 큰 장부는 1..BIG, 나머지 장부 l(2..)은 BIG + (l - 2) * SMALL + t.
        lap("시드 큰 장부 거래", () -> insertTransactions("1", "generate_series(1, %d) t".formatted(BIG), "t",
                "date '2026-11-27' - mod(t, 3650)"));
        lap("시드 작은 장부 거래", () -> insertTransactions("l", "generate_series(2, %d) l, generate_series(1, %d) t".formatted(LEDGERS, SMALL),
                "%d + (l - 2) * %d + t".formatted(BIG, SMALL), "date '2026-11-27' - mod(l * 37 + t * 365, 3650)"));
        lap("analyze", () -> jdbc.execute(
                "analyze users, ledger, ledger_member, account, category, transaction, transaction_line"));
    }

    private void lap(String name, Runnable work) {
        String outer = step;
        long outerStarted = stepStarted;
        worker = Thread.currentThread();
        step = name;
        stepStarted = System.nanoTime();
        try {
            work.run();
        } finally {
            System.out.printf("[plan] 진단 %s: %d ms (GC 누적 %d ms, 부하 %.2f)%n", name,
                    (System.nanoTime() - stepStarted) / 1_000_000, gcMillis(),
                    ManagementFactory.getOperatingSystemMXBean().getSystemLoadAverage());
            step = outer;
            stepStarted = outerStarted;
        }
    }

    private static long gcMillis() {
        return ManagementFactory.getGarbageCollectorMXBeans().stream()
                .mapToLong(GarbageCollectorMXBean::getCollectionTime).sum();
    }

    /** 한 단계가 4초를 넘기면 5초마다 테스트 스레드의 스택 윗부분과 DB의 쉬지 않는 세션을 남긴다. */
    private synchronized void startWatchdog() {
        if (watchdog != null) {
            return;
        }
        JdbcTemplate other = new JdbcTemplate(dataSource);
        watchdog = new Thread(() -> {
            while (true) {
                try {
                    TimeUnit.SECONDS.sleep(5);
                    String name = step;
                    long seconds = (System.nanoTime() - stepStarted) / 1_000_000_000;
                    Thread target = worker;
                    if (name.isEmpty() || seconds < 4 || target == null) {
                        continue;
                    }
                    List<String> lines = new ArrayList<>();
                    lines.add("단계 " + name + " " + seconds + "초째, 스레드 " + target.getState());
                    for (StackTraceElement frame : List.of(target.getStackTrace()).subList(0,
                            Math.min(12, target.getStackTrace().length))) {
                        lines.add("  at " + frame);
                    }
                    other.queryForList("""
                            select backend_type, state,
                                   coalesce(wait_event_type, '-') || '/' || coalesce(wait_event, '-') as wait,
                                   round(extract(epoch from clock_timestamp() - xact_start))::int as xact_s,
                                   left(regexp_replace(coalesce(query, ''), '\\s+', ' ', 'g'), 80) as query
                            from pg_stat_activity
                            where pid <> pg_backend_pid() and state is distinct from 'idle'
                            """).forEach(row -> lines.add("  db " + row));
                    print("진단 느린 단계", lines);
                } catch (InterruptedException e) {
                    return;
                } catch (RuntimeException e) {
                    System.out.println("[plan] 진단 실패: " + e);
                }
            }
        }, "list-plan-watchdog");
        watchdog.setDaemon(true);
        watchdog.start();
    }

    private void insertTransactions(String ledger, String rows, String n, String date) {
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, occurred_time, status, created_by, paid_by,
                                         version, created_at, updated_at)
                select %s, %s, 'EXPENSE', %s,
                       case when mod(%s, 4) = 0 then null else time '00:00' + mod(%s, 1440) * interval '1 minute' end,
                       'POSTED', %s, %s, 1, now(), now()
                from %s
                """.formatted(idSql(TRANSACTION, n), idSql(LEDGER, ledger), date, n, n, idSql(USER, ledger),
                idSql(USER, ledger), rows));
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, category_id, amount, created_at)
                select %s, %s, %s, %s, %s, -1000, now() from %s
                """.formatted(idSql(LINE, n), idSql(TRANSACTION, n), idSql(LEDGER, ledger), idSql(ACCOUNT, ledger),
                idSql(CATEGORY, ledger), rows));
    }

    /** 홈의 최근 거래와 오프라인 사본(#238)이 쓰는 장부 전체 모드: 첫 쪽과, 시각 있는 키 뒤의 쪽, 그 쪽의 날마다 합계. */
    @Test
    void 장부_전체_모드는_큰_장부에서도_인덱스를_거꾸로_읽다가_쪽이_차면_멈춘다() {
        List<Statement> first = statements(new WholeLedger(), null);
        List<Statement> after = statements(new WholeLedger(),
                new TransactionKey(LocalDate.of(2026, 6, 1), LocalTime.of(12, 0), UUID.randomUUID()));

        for (Statement page : List.of(pick(first, Kind.PAGE), pick(after, Kind.PAGE))) {
            String custom = explain(page, "force_custom_plan");
            // 비트맵 훑기는 장부의 거래를 모두 모은 뒤 정렬한다. 바깥 질의도 쪽의 id로만 찾아야 한다.
            assertThat(custom).contains(INDEX_BACKWARD).doesNotContain("Seq Scan", "Bitmap Heap Scan");
            assertThat(rowsReadFromIndex(custom)).as("큰 장부 %d건 가운데 읽은 거래", BIG).isLessThan(500);
            assertThat(explain(page, "force_generic_plan")).doesNotContain("Seq Scan");
        }
        assertThat(first.stream().map(Statement::kind)).as("장부 전체 모드에는 범위 합계가 없다").doesNotContain(Kind.TOTALS);
        Statement days = pick(first, Kind.DAYS);
        assertThat(explain(days, "force_custom_plan")).contains("ix_transaction_ledger_occurred_on")
                .doesNotContain("Seq Scan");
        assertThat(explain(days, "force_generic_plan")).doesNotContain("Seq Scan");
    }

    /** 달 모드는 쪽도, 그 달의 합계도, 날마다 합계도 그 달만 읽는다. 큰 장부의 한 달은 약 165건이다. */
    @Test
    void 달_모드는_큰_장부에서_그_달의_거래만_읽는다() {
        List<Statement> month = statements(new Month(YearMonth.of(2026, 11)), null);

        for (Kind kind : List.of(Kind.PAGE, Kind.TOTALS, Kind.DAYS)) {
            Statement statement = pick(month, kind);
            assertThat(explain(statement, "force_custom_plan")).contains("ix_transaction_ledger_occurred_on")
                    .doesNotContain("Seq Scan");
            assertThat(explain(statement, "force_generic_plan")).doesNotContain("Seq Scan");
        }
    }

    /**
     * 필터(#62)를 모두 켠 달 모드도 쪽, 그 달의 합계, 날마다 합계가 새 인덱스 없이 장부·날짜 인덱스로 그 달만 읽는다. 계좌와
     * 카테고리 조건은 라인에 걸려 라인 테이블의 Seq Scan으로 갈릴 수 있어 그 노드만 상한에서 뺀다({@link #LINE_SEQ_SCAN}).
     * 큰 장부의 라인은 모두 같은 계좌·카테고리라, 라인을 계좌나 카테고리의 인덱스로 읽는 계획이면 2만 행으로 걸린다.
     */
    @Test
    void 필터를_켠_달_모드도_큰_장부에서_그_달의_거래만_읽는다() {
        TransactionFilter filter = new TransactionFilter(Set.of(id(ACCOUNT, 1)), Set.of(id(CATEGORY, 1)),
                Set.of(TransactionType.EXPENSE), TransactionStatus.POSTED);
        List<Statement> month = statements("필터 2026-11", () -> assertThat(listQuery.page(BIG_OWNER, BIG_LEDGER,
                new Month(YearMonth.of(2026, 11)), filter, null, TransactionListQuery.MAX_LIMIT).items())
                .hasSize(TransactionListQuery.MAX_LIMIT));

        for (Kind kind : List.of(Kind.PAGE, Kind.TOTALS, Kind.DAYS)) {
            Statement statement = pick(month, kind);
            String custom = explain(statement, "force_custom_plan");
            assertThat(custom).contains("ix_transaction_ledger_occurred_on");
            assertThat(mostRowsReadExceptLineSeqScan(custom)).as("%s: 큰 장부 %d건 가운데 한 훑기가 읽은 행", kind, BIG)
                    .isLessThan(500);
            assertThat(explain(statement, "force_generic_plan")).doesNotContain("Seq Scan");
        }
    }

    /**
     * 달력의 날짜별 합계(#66)는 그 달만 읽는다. 큰 장부의 11월(1일~27일)은 약 150건이다. 거래는 장부·날짜 인덱스로 그 달만
     * 읽고, 라인 테이블의 Seq Scan({@link #LINE_SEQ_SCAN})을 뺀 어느 훑기도 그보다 크게 늘지 않는다.
     */
    @Test
    void 날짜별_합계는_큰_장부에서_그_달의_거래만_읽는다() {
        List<Statement> daily = statements("날짜별 합계 2026-11", () -> assertThat(
                listQuery.dailyTotals(BIG_OWNER, BIG_LEDGER, YearMonth.of(2026, 11))).hasSize(27));

        Statement sums = pick(daily, Kind.MONTH_DAYS);
        String custom = explain(sums, "force_custom_plan");
        assertThat(custom).contains("ix_transaction_ledger_occurred_on");
        assertThat(mostRowsReadExceptLineSeqScan(custom)).as("큰 장부 %d건 가운데 한 훑기가 읽은 행", BIG)
                .isLessThan(500);
        assertThat(explain(sums, "force_generic_plan")).doesNotContain("Seq Scan");
    }

    /**
     * 월별 통계(#16)도 그 달만 읽는다. 달의 구간 조건이 날짜별 합계와 같다. 카테고리에 장부 조건을 걸면 카테고리부터 읽어
     * 그 카테고리의 라인 2만 건을 라인의 카테고리 인덱스로 모두 읽었다. 그 계획은 읽은 행 상한이 막는다(라인 테이블의
     * Seq Scan만 상한에서 빠진다, {@link #LINE_SEQ_SCAN}).
     */
    @Test
    void 월별_통계는_큰_장부에서_그_달의_거래만_읽는다() {
        List<Statement> monthly = statements("월별 통계 2026-11", () -> assertThat(
                monthlyStatsQuery.monthly(BIG_OWNER, BIG_LEDGER, YearMonth.of(2026, 11)).expense()).isPositive());

        Statement sums = pick(monthly, Kind.TOTALS);
        String custom = explain(sums, "force_custom_plan");
        assertThat(custom).contains("ix_transaction_ledger_occurred_on");
        assertThat(mostRowsReadExceptLineSeqScan(custom)).as("큰 장부 %d건 가운데 한 훑기가 읽은 행", BIG)
                .isLessThan(500);
        assertThat(explain(sums, "force_generic_plan")).doesNotContain("Seq Scan");
    }

    /**
     * 연 단위 통계(#10)는 한 문장으로 그해만 읽는다. 큰 장부의 2025년은 2,190건이다(2만 건 가운데). 조건은 월별 통계와 같고
     * 범위만 한 해다. 거래는 장부·날짜 인덱스로 그해만 읽는다({@link #ON_TRANSACTION_TABLE}).
     */
    @Test
    void 연_단위_통계는_큰_장부에서_그해의_거래만_한_문장으로_읽는다() {
        List<Statement> yearly = statements("연 단위 통계 2025", () -> assertThat(
                yearlyStatsQuery.yearly(BIG_OWNER, BIG_LEDGER, Year.of(2025)).expense()).isEqualTo(2_190_000));

        Statement sums = pick(yearly, Kind.YEAR_MONTHS);
        String custom = explain(sums, "force_custom_plan");
        assertThat(custom).contains("ix_transaction_ledger_occurred_on").doesNotContain("ix_transaction_line_category");
        assertThat(mostRowsRead(custom, ON_TRANSACTION_TABLE)).as("큰 장부 %d건 가운데 거래 테이블에서 읽은 행", BIG)
                .isLessThan(3_000);
        assertThat(explain(sums, "force_generic_plan")).doesNotContain("Seq Scan");
    }

    /**
     * 중복 경고(#59)는 새 인덱스 없이 장부·날짜 인덱스로 그날의 거래만 읽는다(큰 장부의 하루는 약 6건). 그날의 거래에
     * 가맹점을 넣어 라인까지 읽게 한다. 읽은 행 상한은 날짜별 합계와 같은 방식이다({@link #LINE_SEQ_SCAN}).
     */
    @Test
    void 중복_경고는_큰_장부에서_그날의_거래만_읽는다() {
        LocalDate day = LocalDate.of(2026, 11, 18);
        jdbc.update("update transaction set payee = 'P 7' where ledger_id = ? and occurred_on = ?", BIG_LEDGER, day);
        List<Statement> found = statements("중복 경고 " + day, () -> assertThat(
                listQuery.duplicates(BIG_OWNER, BIG_LEDGER, day, 1_000, "p7", null)).isNotEmpty());

        Statement duplicates = pick(found, Kind.DUPLICATES);
        String custom = explain(duplicates, "force_custom_plan");
        assertThat(custom).contains("ix_transaction_ledger_occurred_on");
        assertThat(mostRowsReadExceptLineSeqScan(custom)).as("큰 장부 %d건 가운데 한 훑기가 읽은 행", BIG)
                .isLessThan(100);
        assertThat(explain(duplicates, "force_generic_plan")).doesNotContain("Seq Scan");
    }

    /**
     * 검색(#64)은 새 인덱스 없이 장부·날짜 인덱스로 좁힌다. 기간을 주면 쪽과 합계가 그 기간만 읽지만, 기간이 없으면 장부의
     * 거래를 모두 훑는다(가맹점·메모의 부분 일치에 쓸 인덱스가 없다. 받아들일지는 perf·dba가 정한다). 맞는 거래가 없는
     * 검색어라 쪽이 차서 멈추지 않는다. 숫자라 금액 조건도 든다.
     */
    @Test
    void 검색은_기간을_주면_그_기간만_읽고_기간이_없으면_장부_전체를_훑는다() {
        TransactionSearch month = new TransactionSearch("12345", LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 30));
        List<Statement> november = statements("검색 2026-11", () -> assertThat(listQuery.search(BIG_OWNER, BIG_LEDGER,
                month, TransactionFilter.NONE, null).items()).isEmpty());
        TransactionSearch always = new TransactionSearch("12345", null, null);
        List<Statement> whole = statements("검색 기간 없음", () -> assertThat(listQuery.search(BIG_OWNER, BIG_LEDGER,
                always, TransactionFilter.NONE, null).items()).isEmpty());

        for (Kind kind : List.of(Kind.PAGE, Kind.TOTALS)) {
            String custom = explain(pick(november, kind), "force_custom_plan");
            assertThat(custom).contains("ix_transaction_ledger_occurred_on");
            assertThat(mostRowsReadExceptLineSeqScan(custom)).as("%s: 큰 장부 %d건 가운데 한 훑기가 읽은 행", kind, BIG)
                    .isLessThan(500);
            assertThat(mostRowsReadExceptLineSeqScan(explain(pick(whole, kind), "force_custom_plan")))
                    .as("%s: 기간 없는 검색은 큰 장부의 거래 %d건을 모두 읽는다", kind, BIG).isGreaterThanOrEqualTo(BIG);
        }
    }

    /** 앱의 문장을 그대로 PREPARE하고 받은 값으로 실행한 계획. 비교용으로 인덱스를 끈 계획의 비용도 남긴다. */
    private String explain(Statement statement, String planCacheMode) {
        String name = "list_plan_" + PREPARED.incrementAndGet();
        jdbc.execute("prepare " + name + " as " + numbered(statement.sql()));
        // 로그의 날짜는 LocalDate.toString이라 네 자리를 넘는 해에 +가 붙는다(종료일 없는 검색의 끝인 10000-01-01).
        // PostgreSQL의 날짜 입력은 +를 받지 않아 뗀다. 앱은 JDBC로 날짜 값을 보내므로 이 글자를 쓰지 않는다.
        String execute = "execute " + name + statement.values().stream()
                .map(value -> value.matches("\\+[0-9]{5,}-[0-9]{2}-[0-9]{2}") ? value.substring(1) : value)
                .map(value -> "'" + value.replace("'", "''") + "'")
                .collect(joining(", ", "(", ")"));
        jdbc.execute("set local plan_cache_mode = " + planCacheMode);
        String title = statement.label() + " " + statement.kind();
        String plan = plan(title + ": " + planCacheMode, "explain (analyze, buffers) " + execute);
        jdbc.execute("set local plan_cache_mode = force_custom_plan");
        if (planCacheMode.equals("force_custom_plan")) {
            jdbc.execute("set local enable_indexscan = off");
            jdbc.execute("set local enable_bitmapscan = off");
            plan(title + ": 비교용, 인덱스를 끈 계획", "explain " + execute);
            jdbc.execute("set local enable_indexscan = on");
            jdbc.execute("set local enable_bitmapscan = on");
        }
        jdbc.execute("deallocate " + name);
        return plan;
    }

    private static Statement pick(List<Statement> statements, Kind kind) {
        List<Statement> found = statements.stream().filter(statement -> statement.kind() == kind).toList();
        assertThat(found).as(kind.name()).hasSize(1);
        return found.getFirst();
    }

    /** 큰 장부의 한 쪽을 실제로 읽고, 그때 Hibernate가 보낸 문장과 그 값을 순서대로. */
    private List<Statement> statements(TransactionScope scope, TransactionKey after) {
        return statements(scope + (after == null ? " 첫 쪽" : " 다음 쪽"), () -> assertThat(
                listQuery.page(BIG_OWNER, BIG_LEDGER, scope, TransactionFilter.NONE, after,
                        TransactionListQuery.MAX_LIMIT).items())
                .hasSize(TransactionListQuery.MAX_LIMIT));
    }

    /** call이 Hibernate로 보낸 문장과 그 값을 순서대로. */
    private List<Statement> statements(String label, Runnable call) {
        Logger sqlLog = (Logger) LoggerFactory.getLogger("org.hibernate.SQL");
        Logger bindLog = (Logger) LoggerFactory.getLogger("org.hibernate.orm.jdbc.bind");
        Level sqlLevel = sqlLog.getLevel();
        Level bindLevel = bindLog.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        sqlLog.addAppender(appender);
        bindLog.addAppender(appender);
        sqlLog.setLevel(Level.DEBUG);
        bindLog.setLevel(Level.TRACE);
        try {
            lap(label + " 호출", call);
        } finally {
            sqlLog.setLevel(sqlLevel);
            bindLog.setLevel(bindLevel);
            sqlLog.detachAppender(appender);
            bindLog.detachAppender(appender);
        }
        List<Statement> statements = new ArrayList<>();
        for (ILoggingEvent event : appender.list) {
            String message = event.getFormattedMessage().strip();
            Matcher bind = BIND.matcher(message);
            if (event.getLoggerName().equals("org.hibernate.SQL")) {
                statements.add(new Statement(label, message, new ArrayList<>()));
            } else if (bind.matches()) {
                List<String> values = statements.getLast().values();
                assertThat(Integer.parseInt(bind.group(1))).isEqualTo(values.size() + 1);
                values.add(bind.group(2));
            }
        }
        statements.forEach(statement -> assertThat(statement.sql().chars().filter(c -> c == '?').count())
                .as(statement.sql()).isEqualTo(statement.values().size()));
        print(label + "의 문장", statements.stream().map(Statement::sql).toList());
        return statements;
    }

    /** 인덱스 훑기 노드가 실제로 내놓은 행 수. */
    private static long rowsReadFromIndex(String plan) {
        Matcher matcher = Pattern.compile(Pattern.quote(INDEX_BACKWARD) + ".*?actual time=\\S+ rows=(\\d+)")
                .matcher(plan);
        assertThat(matcher.find()).as(plan).isTrue();
        return Long.parseLong(matcher.group(1));
    }

    /**
     * 훑기 노드마다 실제로 읽은 행(내놓은 행과 조건으로 거른 행을 더해 loops를 곱한 값) 가운데 가장 큰 값. 라인 테이블의
     * Seq Scan({@link #LINE_SEQ_SCAN})은 뺀다. 거래를 장부 전체로 읽거나 라인을 거래 id가 아닌 인덱스(카테고리 등)로 많이
     * 읽는 계획이면 Seq Scan이 아니어도 여기서 큰 장부의 거래 수만큼 나온다.
     */
    private static long mostRowsReadExceptLineSeqScan(String plan) {
        return mostRowsRead(plan, line -> !line.contains(LINE_SEQ_SCAN));
    }

    /** 훑기 노드 가운데 counted가 받는 줄만 세는 {@link #mostRowsReadExceptLineSeqScan}. */
    private static long mostRowsRead(String plan, Predicate<String> counted) {
        Pattern node = Pattern.compile("actual time=\\S+ rows=(\\d+)(?:\\.\\d+)? loops=(\\d+)");
        Pattern removed = Pattern.compile("Rows Removed by (?:Filter|Index Recheck): (\\d+)");
        long most = 0;
        long rows = 0;
        long loops = 0;
        for (String line : plan.lines().toList()) {
            Matcher read = node.matcher(line);
            Matcher filtered = removed.matcher(line);
            if (read.find()) {
                boolean scan = line.contains("Scan") && counted.test(line);
                rows = scan ? Long.parseLong(read.group(1)) : 0;
                loops = scan ? Long.parseLong(read.group(2)) : 0;
            } else if (filtered.find()) {
                rows += Long.parseLong(filtered.group(1));
            }
            most = Math.max(most, rows * loops);
        }
        assertThat(most).as(plan).isPositive();
        return most;
    }

    private String plan(String title, String explain) {
        List<String> lines = jdbc.queryForList(explain, String.class);
        print(title, lines);
        return String.join("\n", lines);
    }

    /** JDBC의 ? 자리를 PREPARE의 $1, $2...로 바꾼다. 문장의 문자열 상수는 검색의 이스케이프 글자 '!'뿐이다. */
    private static String numbered(String sql) {
        StringBuilder out = new StringBuilder();
        int n = 0;
        for (char c : sql.toCharArray()) {
            out.append(c == '?' ? "$" + ++n : String.valueOf(c));
        }
        return out.toString();
    }

    /** build.gradle이 "[plan] "으로 시작하는 줄만 빌드 로그에 옮긴다. */
    private static void print(String title, List<String> texts) {
        System.out.println("[plan] ==== " + title + " ====");
        texts.stream().flatMap(String::lines).forEach(line -> System.out.println("[plan] " + line));
    }

    private static UUID id(int table, long n) {
        return UUID.fromString("0000000%d-0000-4000-8000-%012x".formatted(table, n));
    }

    private static String idSql(int table, String n) {
        return "('0000000" + table + "-0000-4000-8000-' || lpad(to_hex(" + n + "), 12, '0'))::uuid";
    }

    private record Statement(String label, String sql, List<String> values) {

        /** 목록이 보내는 문장의 종류. 구성원 확인 등 그 밖의 문장은 null이다. 구성원 확인(exists)도 fetch first를 쓴다. */
        Kind kind() {
            if (sql.contains("translate(")) {
                return Kind.DUPLICATES;
            }
            if (sql.contains("left join transaction_line") && sql.contains("fetch first")) {
                return Kind.PAGE;
            }
            if (sql.contains("sum(") && sql.contains("extract(")) {
                return Kind.YEAR_MONTHS;
            }
            if (sql.contains("sum(") && sql.contains("occurred_on>=") && sql.contains("group by")
                    && sql.substring(sql.indexOf("group by")).contains("occurred_on")) {
                return Kind.MONTH_DAYS;
            }
            if (sql.contains("sum(") && sql.contains("occurred_on>=")) {
                return Kind.TOTALS;
            }
            if (sql.contains("sum(") && sql.contains("occurred_on in (")) {
                return Kind.DAYS;
            }
            return null;
        }
    }

    /**
     * 쪽(거래와 라인), 범위 합계, 쪽에 나온 날마다 합계, 달력의 날짜별 합계(달 범위를 날마다 묶는다), 중복 경고, 연 단위
     * 통계(한 해를 달마다 묶는다).
     */
    private enum Kind {
        PAGE, TOTALS, DAYS, MONTH_DAYS, DUPLICATES, YEAR_MONTHS
    }
}
