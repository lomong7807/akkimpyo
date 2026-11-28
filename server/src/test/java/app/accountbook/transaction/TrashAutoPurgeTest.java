package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 휴지통 30일 자동 삭제(#9, #60). 대상은 {@code deletedAt + 30일}이 된 거래이고 시각으로 비교한다(장부 시간대를 쓰지 않는다).
 * 기록 행은 바꾼 사람이 없고 action이 사람이 한 완전 삭제와 다른 AUTO_PURGE다(ADR 007 결정 6).
 * 휴지통에 넣은 시각은 다른 테스트가 커밋한 휴지통 거래(2026년)와 겹치지 않게 2021년 근처로 둔다.
 */
@IntegrationTest
class TrashAutoPurgeTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final Duration MINUTE = Duration.ofMinutes(1);
    static final Instant TRASHED = Instant.parse("2021-01-10T03:00:00Z");

    @Autowired TrashAutoPurge autoPurge;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;
    UUID cash;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
    }

    /** 서울 시각으로 월말과 연말에 휴지통에 넣어도 달력의 "한 달"이 아니라 30일 뒤다. */
    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', textBlock = """
            서울 1월 10일 12:00             | 2021-01-10T03:00:00Z | 2021-02-09T03:00:00Z
            서울 1월 31일 23:30, 2월을 넘는다  | 2021-01-31T14:30:00Z | 2021-03-02T14:30:00Z
            서울 12월 31일 23:30, 해를 넘는다 | 2020-12-31T14:30:00Z | 2021-01-30T14:30:00Z
            """)
    void 휴지통에_넣고_29일_23시간_59분은_남고_30일_1분이면_지운다(String label, Instant deletedAt, Instant due) {
        assertThat(deletedAt.plus(TrashAutoPurge.RETENTION)).isEqualTo(due);
        UUID id = trashedAt(deletedAt);

        autoPurge.purgeExpired(due.minus(MINUTE), TrashAutoPurge.BATCH_SIZE);
        assertThat(exists(id)).as("29일 23시간 59분").isTrue();
        autoPurge.purgeExpired(due.plus(MINUTE), TrashAutoPurge.BATCH_SIZE);
        assertThat(exists(id)).as("30일 1분").isFalse();
    }

    /** 응답의 purgeAt(deletedAt + 30일)이 "대상이 되는 시각"이다. 그 시각에 돌면 지운다. */
    @Test
    void 정확히_30일이_된_거래부터_대상이다() {
        UUID id = trashedAt(TRASHED);

        autoPurge.purgeExpired(TRASHED.plus(TrashAutoPurge.RETENTION), TrashAutoPurge.BATCH_SIZE);

        assertThat(exists(id)).isFalse();
    }

    @Test
    void 바꾼_사람이_없는_AUTO_PURGE_기록_한_행만_남기고_두_번_돌아도_하나다() {
        UUID id = trashedAt(TRASHED);
        UUID live = fixtures.expense(owner, ledgerId, cash, null, DAY, 5_000).id();
        Instant now = TRASHED.plus(TrashAutoPurge.RETENTION).plus(MINUTE);

        autoPurge.purgeExpired(now, TrashAutoPurge.BATCH_SIZE);
        autoPurge.purgeExpired(now, TrashAutoPurge.BATCH_SIZE);
        flushAndClear();

        assertThat(jdbc.queryForObject("select count(*) from transaction_line where transaction_id = ?",
                Integer.class, id)).isZero();
        assertThat(logs(id)).singleElement().satisfies(log -> {
            assertThat(log).containsEntry("ledger_id", ledgerId).containsEntry("version", 3L)
                    .containsEntry("action", "AUTO_PURGE").containsEntry("actor_id", null)
                    .containsEntry("device_id", null).containsEntry("before_value", null)
                    .containsEntry("after_value", null);
            assertThat(((Timestamp) log.get("created_at")).toInstant()).isEqualTo(now);
        });
        assertThat(exists(live)).isTrue();
        assertThat(logs(live)).hasSize(1);
    }

    @Test
    void 정해진_건수씩_나눠_남김없이_지운다() {
        List<UUID> ids = IntStream.range(0, 5).mapToObj(i -> trashedAt(TRASHED.plusSeconds(i))).toList();

        int purged = autoPurge.purgeExpired(TRASHED.plus(TrashAutoPurge.RETENTION).plus(MINUTE), 2);
        flushAndClear();

        assertThat(purged).isGreaterThanOrEqualTo(ids.size());
        assertThat(ids).noneMatch(this::exists)
                .allSatisfy(id -> assertThat(logs(id)).extracting(log -> log.get("action"))
                        .containsExactly("AUTO_PURGE"));
    }

    // ---------------------------------------------------------------- 도우미

    /** 휴지통에 넣은 거래(version 2)의 삭제 시각을 바꾼다. */
    private UUID trashedAt(Instant deletedAt) {
        TransactionView tx = fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, DAY, 12_000));
        flushAndClear();
        jdbc.update("update transaction set deleted_at = ? where id = ?", Timestamp.from(deletedAt), tx.id());
        return tx.id();
    }

    private boolean exists(UUID id) {
        return jdbc.queryForObject("select count(*) from transaction where id = ?", Integer.class, id) == 1;
    }

    private List<Map<String, Object>> logs(UUID txId) {
        return jdbc.queryForList("""
                select ledger_id, version, action, actor_id, device_id, before_value, after_value, created_at
                  from change_log where transaction_id = ? order by version
                """, txId);
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
