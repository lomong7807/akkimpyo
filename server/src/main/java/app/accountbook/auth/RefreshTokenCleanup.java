package app.accountbook.auth;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 절대 만료(계열의 시작부터 180일)가 지난 refresh token 계열과 그 토큰 행을 매일 한 번 지운다(ADR 001 결정 3, #132).
 * 만료되거나 폐기된 계열도 절대 만료 전에는 재사용 감지에 쓰이므로 남긴다. 절대 만료부터는 갱신이 어느 토큰도 받지 않으므로
 * 지워도 갱신의 결과(거부)가 같다. 대상 판정은 시각 비교이고 작업이 도는 날만 Asia/Seoul로 정한다. 그래서 실제 삭제는
 * 절대 만료부터 최대 하루 늦다.
 *
 * <p>정해진 수의 계열씩 각자의 트랜잭션에서 지운다. 계열 행을 먼저 잠그고 그 토큰, 계열 순으로 지운다. 회전은 계열 행을
 * 잠가야 토큰을 넣으므로 잠근 계열에 새 토큰이 생기지 않는다. 갱신이나 폐기가 잠근 계열은 건너뛰고 다음 날 지운다.
 * 로그에는 지운 건수만 남긴다. 실패해도 예외를 스케줄러로 내지 않고 로그만 남긴다. 로그인과 갱신은 이 작업과 따로 돈다.
 *
 * <p>공개 메서드가 없다. 스케줄러만 부른다(ServiceMethodInventoryTest).
 */
@Component
final class RefreshTokenCleanup {

    /**
     * 매일 04:30. 휴지통 자동 삭제(04:00)와 겹치지 않게 둔다. 설정 {@code accountbook.refresh-token-cleanup.cron}으로
     * 바꾸고 {@code -}로 끈다(테스트).
     */
    static final String CRON = "0 30 4 * * *";
    static final String ZONE = "Asia/Seoul";
    /** 한 트랜잭션에서 지우는 계열 수. 계열마다 토큰은 갱신한 횟수만큼 있다. */
    static final int BATCH_SIZE = 100;

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenCleanup.class);

    private final JdbcClient jdbc;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    RefreshTokenCleanup(JdbcClient jdbc, TransactionTemplate transactionTemplate, Clock clock) {
        this.jdbc = jdbc;
        this.transactionTemplate = transactionTemplate;
        this.clock = clock;
    }

    @Scheduled(cron = "${accountbook.refresh-token-cleanup.cron:" + CRON + "}", zone = ZONE)
    void run() {
        try {
            Deleted deleted = deleteExpired(clock.instant().truncatedTo(ChronoUnit.MICROS), BATCH_SIZE);
            log.info("refresh token cleanup: {} families, {} tokens", deleted.families(), deleted.tokens());
        } catch (RuntimeException e) {
            log.error("refresh token cleanup failed", e);
        }
    }

    /** 절대 만료가 {@code now} 이전(같은 시각 포함)인 계열과 그 토큰을 모두 지운다. */
    Deleted deleteExpired(Instant now, int batchSize) {
        int families = 0;
        int tokens = 0;
        Deleted batch;
        do {
            batch = Objects.requireNonNull(transactionTemplate.execute(status -> deleteBatch(now, batchSize)));
            families += batch.families();
            tokens += batch.tokens();
        } while (batch.families() == batchSize);
        return new Deleted(families, tokens);
    }

    private Deleted deleteBatch(Instant now, int batchSize) {
        List<UUID> ids = jdbc.sql("""
                        select id from refresh_token_family where absolute_expires_at <= :now
                         limit :limit for update skip locked
                        """)
                .param("now", now.atOffset(ZoneOffset.UTC)).param("limit", batchSize)
                .query((rs, row) -> rs.getObject("id", UUID.class)).list();
        if (ids.isEmpty()) {
            return new Deleted(0, 0);
        }
        int tokens = jdbc.sql("delete from refresh_token where family_id in (:ids)").param("ids", ids).update();
        int families = jdbc.sql("delete from refresh_token_family where id in (:ids)").param("ids", ids).update();
        return new Deleted(families, tokens);
    }

    /** 지운 계열과 토큰의 수. */
    record Deleted(int families, int tokens) {
    }
}
