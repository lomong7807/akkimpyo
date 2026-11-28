package app.accountbook;

import static java.util.stream.Collectors.joining;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.category.CategoryRepository;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionLineRepository;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.sql.SQLWarning;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.StatementCallback;

/**
 * 카테고리를 지우기 전 확인 둘, 사람이 속한 장부 찾기, 카테고리 삭제의 FK 확인이 테이블 전체를 훑지 않는다(#67, V19).
 * 장부 1,000개가 섞인 DB를 테스트 트랜잭션 안에 만들고 실제 계획을 {@code EXPLAIN (ANALYZE, BUFFERS)}로 본다.
 *
 * <p>계획이 흔들리지 않게 하는 것:
 * <ul>
 *   <li>시험 데이터는 고정 id로 SQL이 만든다. 테이블마다 3만 행 이하라 ANALYZE가 표본이 아니라 모든 행을 읽어 통계가 매번 같다.</li>
 *   <li>ANALYZE를 테스트 트랜잭션 안에서 한다. 그 잠금을 롤백까지 쥐므로 자동 ANALYZE가 중간에 통계를 바꾸지 못한다.</li>
 *   <li>찾는 값 하나가 테이블의 수천분의 1이다. 비교용으로 인덱스를 끈 계획의 비용을 같이 남겨 여유를 보인다.</li>
 *   <li>값을 넣은 계획(앱이 쓰는 계획, #112)은 인덱스 이름을, 일반 계획은 전체 훑기가 없다는 것만 단정한다.</li>
 * </ul>
 * 계획은 "[plan] "으로 시작하는 줄로 출력하고, build.gradle이 그 줄만 빌드 로그에 옮긴다.
 */
@IntegrationTest
class LookupIndexPlanTest {

    /** 장부 수. 사람마다 개인 장부 하나(OWNER)와 다음 번호 장부의 구성원 자리 하나(MEMBER)가 있다. */
    private static final int LEDGERS = 1_000;

    // 고정 id의 앞자리. 테이블마다 다르다.
    private static final int USER = 1;
    private static final int LEDGER = 2;
    private static final int MEMBER = 3;
    private static final int ACCOUNT = 4;
    private static final int CATEGORY = 5;
    private static final int TRANSACTION = 6;
    private static final int LINE = 7;

    /** 첫 장부의 4번 카테고리. 최상위이고 하위 분류도 라인도 없어 지울 수 있다. */
    private static final UUID UNUSED_CATEGORY = id(CATEGORY, 4);

    /** 첫 사람. 1번 장부(OWNER)와 2번 장부(MEMBER)에 있다. */
    private static final UUID FIRST_USER = id(USER, 1);

    /** PREPARE는 롤백돼도 연결에 남는다. 테스트가 중간에 실패해도 다음 이름과 겹치지 않게 번호를 붙인다. */
    private static final AtomicInteger PREPARED = new AtomicInteger();

    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionLineRepository lineRepository;
    @Autowired CategoryRepository categoryRepository;
    @Autowired LedgerMemberRepository memberRepository;

    /**
     * 장부마다 계좌 2, 카테고리 10(최상위 1~4, 5~10은 1~3의 하위), 거래 20(지출 18건은 라인 1, 이체 2건은 라인 2).
     * 지출 라인은 4번을 뺀 카테고리 9개에 고르게 나눈다. 행 수: 사람 1,000, 구성원 2,000, 카테고리 10,000, 라인 22,000.
     */
    @BeforeEach
    void seedManyLedgersAndAnalyze() {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                select %s, 'lookup-plan-' || g || '@example.com', 'hash', 'u' || g, now()
                from generate_series(1, %d) g
                """.formatted(idSql(USER, "g"), LEDGERS));
        jdbc.update("""
                insert into ledger (id, name, created_at)
                select %s, 'l' || g, now()
                from generate_series(1, %d) g
                """.formatted(idSql(LEDGER, "g"), LEDGERS));
        jdbc.update("""
                insert into ledger_member (id, ledger_id, user_id, role, created_at)
                select %s, %s, %s, case when m = 1 then 'OWNER' else 'MEMBER' end, now()
                from generate_series(1, %d) g, generate_series(1, 2) m
                """.formatted(idSql(MEMBER, "(g - 1) * 2 + m"),
                idSql(LEDGER, "case when m = 1 then g else mod(g, " + LEDGERS + ") + 1 end"),
                idSql(USER, "g"), LEDGERS));
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
                select %s, %s, 'a' || a, 'BANK', 0, date '2026-01-01', now()
                from generate_series(1, %d) l, generate_series(1, 2) a
                """.formatted(idSql(ACCOUNT, "(l - 1) * 2 + a"), idSql(LEDGER, "l"), LEDGERS));
        jdbc.update("""
                insert into category (id, ledger_id, kind, name, parent_id, system, created_at)
                select %s, %s, 'EXPENSE', 'c' || c, case when c > 4 then %s end, false, now()
                from generate_series(1, %d) l, generate_series(1, 10) c
                """.formatted(idSql(CATEGORY, "(l - 1) * 10 + c"), idSql(LEDGER, "l"),
                idSql(CATEGORY, "(l - 1) * 10 + mod(c - 5, 3) + 1"), LEDGERS));
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, status, created_by, paid_by, version,
                                         created_at, updated_at)
                select %s, %s, case when t <= 18 then 'EXPENSE' else 'TRANSFER' end, date '2026-11-01' + mod(t, 28),
                       'POSTED', %s, %s, 1, now(), now()
                from generate_series(1, %d) l, generate_series(1, 20) t
                """.formatted(idSql(TRANSACTION, "(l - 1) * 20 + t"), idSql(LEDGER, "l"), idSql(USER, "l"),
                idSql(USER, "l"), LEDGERS));
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, category_id, amount, created_at)
                select %s, %s, %s, %s, %s, -1000, now()
                from generate_series(1, %d) l, generate_series(1, 18) t
                """.formatted(idSql(LINE, "(l - 1) * 22 + t"), idSql(TRANSACTION, "(l - 1) * 20 + t"),
                idSql(LEDGER, "l"), idSql(ACCOUNT, "(l - 1) * 2 + 1"),
                idSql(CATEGORY, "(l - 1) * 10 + (array[1, 2, 3, 5, 6, 7, 8, 9, 10])[mod(t - 1, 9) + 1]"), LEDGERS));
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, category_id, amount, created_at)
                select %s, %s, %s, %s, null::uuid, case when s = 1 then -1000 else 1000 end, now()
                from generate_series(1, %d) l, generate_series(19, 20) t, generate_series(1, 2) s
                """.formatted(idSql(LINE, "(l - 1) * 22 + 18 + (t - 19) * 2 + s"),
                idSql(TRANSACTION, "(l - 1) * 20 + t"), idSql(LEDGER, "l"), idSql(ACCOUNT, "(l - 1) * 2 + s"),
                LEDGERS));
        jdbc.execute("analyze users, ledger, ledger_member, account, category, transaction, transaction_line");
    }

    @Test
    void categoryInUseCheckReadsLineCategoryIndex() {
        String sql = sqlOf(() -> assertThat(lineRepository.existsByCategoryId(UNUSED_CATEGORY)).isFalse());

        Plans plans = explain("existsByCategoryId", sql, UNUSED_CATEGORY, 1);

        assertThat(plans.custom()).contains("ix_transaction_line_category").doesNotContain("Seq Scan");
        assertThat(plans.generic()).doesNotContain("Seq Scan");
    }

    @Test
    void subcategoryCheckReadsCategoryParentIndex() {
        String sql = sqlOf(() -> assertThat(categoryRepository.existsByParentId(UNUSED_CATEGORY)).isFalse());

        Plans plans = explain("existsByParentId", sql, UNUSED_CATEGORY, 1);

        assertThat(plans.custom()).contains("ix_category_parent").doesNotContain("Seq Scan");
        assertThat(plans.generic()).doesNotContain("Seq Scan");
    }

    @Test
    void ledgersOfUserReadMemberUserIndex() {
        String sql = sqlOf(() -> assertThat(memberRepository.findByUserId(FIRST_USER)).hasSize(2));

        Plans plans = explain("findByUserId", sql, FIRST_USER);

        assertThat(plans.custom()).contains("ix_ledger_member_user").doesNotContain("Seq Scan");
        assertThat(plans.generic()).doesNotContain("Seq Scan");
    }

    /**
     * 카테고리를 지우면 PostgreSQL이 FK마다 참조하는 행이 있는지 찾는다: 라인(fk_transaction_line_category)과
     * 하위 카테고리(fk_category_parent). 하위 카테고리 쪽은 uq_category_name의 앞 세 컬럼으로도 찾을 수 있어
     * 전체 훑기가 아니라는 것만 단정한다.
     */
    @Test
    void foreignKeyChecksOfCategoryDeleteDoNotScanWholeTables() {
        List<String> plans = plansWithTriggerQueries("delete from category where id = '" + UNUSED_CATEGORY + "'");

        String lineCheck = planOf(plans, "FROM ONLY \"public\".\"transaction_line\" x", "\"category_id\"");
        assertThat(lineCheck).contains("ix_transaction_line_category").doesNotContain("Seq Scan");
        String childCheck = planOf(plans, "FROM ONLY \"public\".\"category\" x", "\"parent_id\"");
        assertThat(childCheck).doesNotContain("Seq Scan");
    }

    /** Hibernate가 이 호출에서 DB에 보낸 문장 하나. */
    private static String sqlOf(Runnable call) {
        Logger sqlLog = (Logger) LoggerFactory.getLogger("org.hibernate.SQL");
        Level level = sqlLog.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        sqlLog.addAppender(appender);
        sqlLog.setLevel(Level.DEBUG);
        try {
            call.run();
        } finally {
            sqlLog.setLevel(level);
            sqlLog.detachAppender(appender);
        }
        List<String> statements = appender.list.stream()
                .map(event -> event.getFormattedMessage().strip())
                .toList();
        print("Hibernate가 보낸 SQL", statements);
        assertThat(statements).hasSize(1);
        return statements.get(0);
    }

    /**
     * Hibernate의 문장을 그대로 PREPARE해 값을 넣은 계획과 일반 계획을 실제로 실행해 본다.
     * 비교용으로 인덱스를 끈 계획(실행하지 않고 비용만)도 남긴다.
     */
    private Plans explain(String label, String sql, Object... values) {
        assertThat(sql.chars().filter(c -> c == '?').count()).as(sql).isEqualTo(values.length);
        String name = "lookup_plan_" + PREPARED.incrementAndGet();
        String execute = "execute " + name
                + Arrays.stream(values).map(LookupIndexPlanTest::literal).collect(joining(", ", "(", ")"));
        jdbc.execute("prepare " + name + " as " + numbered(sql));

        jdbc.execute("set local plan_cache_mode = force_custom_plan");
        String custom = plan(label + ": 값을 넣은 계획", "explain (analyze, buffers, format text) " + execute);
        jdbc.execute("set local plan_cache_mode = force_generic_plan");
        String generic = plan(label + ": 일반 계획", "explain (analyze, buffers, format text) " + execute);
        jdbc.execute("set local plan_cache_mode = force_custom_plan");

        jdbc.execute("set local enable_indexscan = off");
        jdbc.execute("set local enable_indexonlyscan = off");
        jdbc.execute("set local enable_bitmapscan = off");
        plan(label + ": 비교용, 인덱스를 끈 계획", "explain " + execute);
        jdbc.execute("set local enable_indexscan = on");
        jdbc.execute("set local enable_indexonlyscan = on");
        jdbc.execute("set local enable_bitmapscan = on");

        jdbc.execute("deallocate " + name);
        return new Plans(custom, generic);
    }

    private String plan(String title, String explain) {
        List<String> lines = jdbc.queryForList(explain, String.class);
        print(title, lines);
        return String.join("\n", lines);
    }

    /**
     * 문장 하나를 실행하고, 그 문장과 그 문장이 부른 트리거 쿼리(FK 확인)의 실제 계획을 받는다.
     * auto_explain을 이 연결에 올려 계획을 NOTICE로 받는다. LOAD는 슈퍼유저만 할 수 있다(Testcontainers의 기본 사용자).
     * 설정은 SET LOCAL이라 롤백과 함께 사라진다.
     */
    private List<String> plansWithTriggerQueries(String sql) {
        jdbc.execute("load 'auto_explain'");
        jdbc.execute("set local auto_explain.log_min_duration = 0");
        jdbc.execute("set local auto_explain.log_analyze = on");
        jdbc.execute("set local auto_explain.log_buffers = on");
        jdbc.execute("set local auto_explain.log_nested_statements = on");
        jdbc.execute("set local auto_explain.log_level = notice");
        List<String> plans = jdbc.execute((StatementCallback<List<String>>) statement -> {
            statement.execute(sql);
            assertThat(statement.getUpdateCount()).isEqualTo(1);
            List<String> notices = new ArrayList<>();
            for (SQLWarning warning = statement.getWarnings(); warning != null; warning = warning.getNextWarning()) {
                notices.add(warning.getMessage());
            }
            return notices;
        });
        jdbc.execute("set local auto_explain.log_min_duration = -1");
        print("카테고리 삭제와 FK 확인(auto_explain)", plans);
        return plans;
    }

    /** 조각을 모두 담은 계획 하나. */
    private static String planOf(List<String> plans, String... fragments) {
        List<String> matching = plans.stream()
                .filter(plan -> Arrays.stream(fragments).allMatch(plan::contains))
                .toList();
        assertThat(matching).as(String.join(" + ", fragments)).hasSize(1);
        return matching.get(0);
    }

    /** JDBC의 ? 자리를 PREPARE의 $1, $2...로 바꾼다. Hibernate의 문장에는 문자열 상수가 없다. */
    private static String numbered(String sql) {
        StringBuilder out = new StringBuilder();
        int n = 0;
        for (char c : sql.toCharArray()) {
            if (c == '?') {
                out.append('$').append(++n);
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    private static String literal(Object value) {
        return value instanceof UUID ? "'" + value + "'" : value.toString();
    }

    /** build.gradle이 "[plan] "으로 시작하는 줄만 빌드 로그에 옮긴다. */
    private static void print(String title, List<String> texts) {
        System.out.println("[plan] ==== " + title + " ====");
        texts.stream().flatMap(String::lines).forEach(line -> System.out.println("[plan] " + line));
    }

    /** 테이블 앞자리와 번호로 만든 고정 id. {@link #idSql}이 SQL 안에서 같은 값을 만든다. */
    private static UUID id(int table, long n) {
        return UUID.fromString("0000000%d-0000-4000-8000-%012x".formatted(table, n));
    }

    private static String idSql(int table, String n) {
        return "('0000000" + table + "-0000-4000-8000-' || lpad(to_hex(" + n + "), 12, '0'))::uuid";
    }

    private record Plans(String custom, String generic) {
    }
}
