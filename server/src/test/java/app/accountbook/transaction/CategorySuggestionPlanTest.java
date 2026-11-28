package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.common.UserText;
import app.accountbook.support.IntegrationTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 가맹점 제안(#61)의 문장이 다른 장부를 읽지 않고, 라인은 고른 거래의 것만 읽는다(docs/db/schema-standards.md 4절).
 * 장부 1,000개가 섞인 DB의 큰 장부(거래 5천 건)에서 앱의 문장({@link CategorySuggestionQuery#LATEST})을
 * {@code EXPLAIN (ANALYZE, BUFFERS)}로 본다. 계획을 흔들리지 않게 하는 방법은 {@code TransactionListPlanTest}와 같다.
 *
 * <p>거래는 그 장부의 것을 모두 읽는다(장부 크기에 비례). 맞춘 가맹점으로 찾는 인덱스가 없어서다. 이 PR은 새 인덱스를
 * 만들지 않는다(#113에서 같이 판단).
 */
@IntegrationTest
class CategorySuggestionPlanTest {

    private static final int LEDGERS = 1_000;
    /** 큰 장부(1번)의 거래 수. 테이블마다 3만 행 이하라 ANALYZE가 모든 행을 읽는다. */
    private static final int BIG = 5_000;
    private static final int SMALL = 25;

    private static final int USER = 1;
    private static final int LEDGER = 2;
    private static final int MEMBER = 3;
    private static final int ACCOUNT = 4;
    private static final int CATEGORY = 5;
    private static final int TRANSACTION = 6;
    private static final int LINE = 7;

    private static final UUID BIG_OWNER = id(USER, 1);
    private static final UUID BIG_LEDGER = id(LEDGER, 1);

    @Autowired CategorySuggestionQuery suggestions;
    @Autowired JdbcTemplate jdbc;

    /** 장부마다 가맹점 50가지('p0'~'p49')가 돌아가며 나온다. 큰 장부의 'p7'은 100건이다. */
    @BeforeEach
    void seedManyLedgersAndAnalyze() {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                select %s, 'suggest-plan-' || g || '@example.com', 'hash', 'u' || g, now() from generate_series(1, %d) g
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
        // 거래 번호는 장부 l, 순번 t로 l * 10000 + t다. 장부 하나의 거래는 한데 모여 들어간다.
        String rows = "generate_series(1, %d) l, generate_series(1, case when l = 1 then %d else %d end) t"
                .formatted(LEDGERS, BIG, SMALL);
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, payee, status, created_by, paid_by,
                                         version, created_at, updated_at)
                select %s, %s, 'EXPENSE', date '2026-11-27' - mod(t, 3650), 'p' || mod(t, 50), 'POSTED', %s, %s, 1,
                       now() - t * interval '1 minute', now()
                from %s
                """.formatted(idSql(TRANSACTION, "l * 10000 + t"), idSql(LEDGER, "l"), idSql(USER, "l"),
                idSql(USER, "l"), rows));
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, category_id, amount, created_at)
                select %s, %s, %s, %s, %s, -1000, now() from %s
                """.formatted(idSql(LINE, "l * 10000 + t"), idSql(TRANSACTION, "l * 10000 + t"), idSql(LEDGER, "l"),
                idSql(ACCOUNT, "l"), idSql(CATEGORY, "l"), rows));
        jdbc.execute("analyze users, ledger, ledger_member, account, category, transaction, transaction_line");
    }

    @Test
    void 큰_장부에서_다른_장부를_읽지_않고_라인은_고른_거래의_것만_찾는다() {
        assertThat(suggestions.suggest(BIG_OWNER, BIG_LEDGER, "P 7")).contains(id(CATEGORY, 1));

        jdbc.execute("prepare suggest_plan as " + CategorySuggestionQuery.LATEST
                .replace(":ledgerId", "$1").replace(":spaces", "$2").replace(":payee", "$3"));
        for (String mode : List.of("force_custom_plan", "force_generic_plan")) {
            jdbc.execute("set local plan_cache_mode = " + mode);
            List<String> lines = jdbc.queryForList("explain (analyze, buffers) execute suggest_plan('%s', '%s', 'P 7')"
                    .formatted(BIG_LEDGER, UserText.TRIMMED_SPACES), String.class);
            lines.forEach(line -> System.out.println("[plan] 가맹점 제안 " + mode + ": " + line));
            String plan = String.join("\n", lines);

            // 거래는 장부 인덱스의 장부 조건으로만 찾고, 라인은 거래 id로 찾는다. 전체 훑기면 다른 장부까지 읽는다.
            assertThat(plan).as(mode).doesNotContain("Seq Scan")
                    .contains("ix_transaction_ledger_occurred_on", "ix_transaction_line_transaction");
        }
        jdbc.execute("set local plan_cache_mode = force_custom_plan");
        jdbc.execute("deallocate suggest_plan");
    }

    private static UUID id(int table, long n) {
        return UUID.fromString("0000000%d-0000-4000-8000-%012x".formatted(table, n));
    }

    private static String idSql(int table, String n) {
        return "('0000000" + table + "-0000-4000-8000-' || lpad(to_hex(" + n + "), 12, '0'))::uuid";
    }
}
