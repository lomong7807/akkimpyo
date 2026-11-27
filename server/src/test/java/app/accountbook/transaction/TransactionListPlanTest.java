package app.accountbook.transaction;

import static java.util.stream.Collectors.joining;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.stats.MonthlyStatsQuery;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionScope.Month;
import app.accountbook.transaction.TransactionScope.WholeLedger;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
    private static final Pattern BIND = Pattern.compile("binding parameter \\((\\d+):[^)]*\\) <- \\[(.*)]");
    private static final AtomicInteger PREPARED = new AtomicInteger();

    @Autowired TransactionListQuery listQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void seedManyLedgersAndAnalyze() {
        clock.stopAt(Instant.parse("2026-11-27T03:00:00Z"));
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                select %s, 'list-plan-' || g || '@example.com', 'hash', 'u' || g, now() from generate_series(1, %d) g
                """.formatted(idSql(USER, "g"), LEDGERS));
        jdbc.update("insert into ledger (id, name, created_at) select %s, 'l' || g, now() from generate_series(1, %d) g"
                .formatted(idSql(LEDGER, "g"), LEDGERS));
        jdbc.update("""
                insert into ledger_member (id, ledger_id, user_id, role, created_at)
                select %s, %s, %s, 'OWNER', now() from generate_series(1, %d) g
                """.formatted(idSql(MEMBER, "g"), idSql(LEDGER, "g"), idSql(USER, "g"), LEDGERS));
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
                select %s, %s, 'a', 'BANK', 0, date '2016-01-01', now() from generate_series(1, %d) g
                """.formatted(idSql(ACCOUNT, "g"), idSql(LEDGER, "g"), LEDGERS));
        jdbc.update("""
                insert into category (id, ledger_id, kind, name, parent_id, system, created_at)
                select %s, %s, 'EXPENSE', 'c', null, false, now() from generate_series(1, %d) g
                """.formatted(idSql(CATEGORY, "g"), idSql(LEDGER, "g"), LEDGERS));
        // 거래 번호 n: 큰 장부는 1..BIG, 나머지 장부 l(2..)은 BIG + (l - 2) * SMALL + t.
        insertTransactions("1", "generate_series(1, %d) t".formatted(BIG), "t",
                "date '2026-11-27' - mod(t, 3650)");
        insertTransactions("l", "generate_series(2, %d) l, generate_series(1, %d) t".formatted(LEDGERS, SMALL),
                "%d + (l - 2) * %d + t".formatted(BIG, SMALL), "date '2026-11-27' - mod(l * 37 + t * 365, 3650)");
        jdbc.execute("analyze users, ledger, ledger_member, account, category, transaction, transaction_line");
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

    /** 앱의 문장을 그대로 PREPARE하고 받은 값으로 실행한 계획. 비교용으로 인덱스를 끈 계획의 비용도 남긴다. */
    private String explain(Statement statement, String planCacheMode) {
        String name = "list_plan_" + PREPARED.incrementAndGet();
        jdbc.execute("prepare " + name + " as " + numbered(statement.sql()));
        String execute = "execute " + name + statement.values().stream()
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
                listQuery.page(BIG_OWNER, BIG_LEDGER, scope, after, TransactionListQuery.MAX_LIMIT).items())
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
            call.run();
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
        Pattern node = Pattern.compile("actual time=\\S+ rows=(\\d+)(?:\\.\\d+)? loops=(\\d+)");
        Pattern removed = Pattern.compile("Rows Removed by (?:Filter|Index Recheck): (\\d+)");
        long most = 0;
        long rows = 0;
        long loops = 0;
        for (String line : plan.lines().toList()) {
            Matcher read = node.matcher(line);
            Matcher filtered = removed.matcher(line);
            if (read.find()) {
                boolean scan = line.contains("Scan") && !line.contains(LINE_SEQ_SCAN);
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

    /** JDBC의 ? 자리를 PREPARE의 $1, $2...로 바꾼다. Hibernate의 문장에는 문자열 상수가 없다. */
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
            if (sql.contains("left join transaction_line") && sql.contains("fetch first")) {
                return Kind.PAGE;
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

    /** 쪽(거래와 라인), 범위 합계, 쪽에 나온 날마다 합계, 달력의 날짜별 합계(달 범위를 날마다 묶는다). */
    private enum Kind {
        PAGE, TOTALS, DAYS, MONTH_DAYS
    }
}
