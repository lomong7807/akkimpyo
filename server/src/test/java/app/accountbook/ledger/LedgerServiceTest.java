package app.accountbook.ledger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.IntStream;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** 내 장부 목록(#30). 남의 장부가 섞이지 않는 것은 CrossLedgerAccessTest가 본다. */
@IntegrationTest
class LedgerServiceTest {

    @Autowired LedgerService ledgerService;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager entityManager;

    @Test
    void 먼저_속한_장부가_앞이고_같은_시각이면_장부_id_순이다() {
        User user = fixtures.user("member@example.com");
        UUID personal = fixtures.personalLedgerId(user);
        // 장부는 나중에 만들어졌지만 가장 먼저 들어갔다.
        UUID first = ledger("5e000000-0000-4000-8000-000000000001", "먼저 들어간 장부", "2026-03-01T00:00:00Z");
        // 같은 시각에 들어간 둘. id 순은 PostgreSQL uuid의 순서(소문자 글자 순과 같다)다.
        // Java의 UUID.compareTo는 부호 있는 비교라 8f…를 1f…보다 앞에 둔다.
        UUID tieHigh = ledger("8f000000-0000-4000-8000-000000000002", "같은 시각 뒤", "2025-01-01T00:00:00Z");
        UUID tieLow = ledger("1f000000-0000-4000-8000-000000000003", "같은 시각 앞", "2025-01-02T00:00:00Z");
        member(first, user, LedgerRole.MEMBER, "2026-01-01T00:00:00Z");
        member(tieHigh, user, LedgerRole.OWNER, "2026-02-01T00:00:00Z");
        member(tieLow, user, LedgerRole.MEMBER, "2026-02-01T00:00:00Z");

        assertThat(ledgerService.memberships(user.getId()))
                .extracting(LedgerMembership::ledgerId, LedgerMembership::name, LedgerMembership::role)
                .containsExactly(
                        tuple(first, "먼저 들어간 장부", LedgerRole.MEMBER),
                        tuple(tieLow, "같은 시각 앞", LedgerRole.MEMBER),
                        tuple(tieHigh, "같은 시각 뒤", LedgerRole.OWNER),
                        tuple(personal, Ledger.PERSONAL_LEDGER_NAME, LedgerRole.OWNER));
    }

    @Test
    void 장부가_늘어도_조회는_한_번이다() {
        User user = fixtures.user("many@example.com");
        fixtures.user("other@example.com");

        assertThat(statements(() -> ledgerService.memberships(user.getId()))).as("장부 1개").isEqualTo(1);

        IntStream.range(0, 4).forEach(i -> member(ledger(UUID.randomUUID().toString(), "장부" + i,
                "2026-01-01T00:00:00Z"), user, LedgerRole.MEMBER, "2026-01-0" + (i + 1) + "T00:00:00Z"));

        assertThat(ledgerService.memberships(user.getId())).hasSize(5);
        assertThat(statements(() -> ledgerService.memberships(user.getId()))).as("장부 5개").isEqualTo(1);
    }

    /** 요청 하나가 DB에 보낸 문장 수. 통계는 이 동안만 켠다. */
    long statements(Supplier<List<LedgerMembership>> query) {
        entityManager.flush();
        entityManager.clear();
        Statistics statistics = entityManager.getEntityManagerFactory().unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        statistics.setStatisticsEnabled(true);
        try {
            query.get();
            return statistics.getPrepareStatementCount();
        } finally {
            statistics.setStatisticsEnabled(false);
            statistics.clear();
        }
    }

    UUID ledger(String id, String name, String createdAt) {
        UUID ledgerId = UUID.fromString(id);
        jdbc.update("insert into ledger (id, name, timezone, created_at) values (?, ?, 'Asia/Seoul', ?)",
                ledgerId, name, Timestamp.from(Instant.parse(createdAt)));
        return ledgerId;
    }

    void member(UUID ledgerId, User user, LedgerRole role, String createdAt) {
        jdbc.update("insert into ledger_member (id, ledger_id, user_id, role, created_at) values (?, ?, ?, ?, ?)",
                UUID.randomUUID(), ledgerId, user.getId(), role.name(), Timestamp.from(Instant.parse(createdAt)));
    }
}
