package app.accountbook.transaction;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 휴지통에 넣은 지 30일이 지난 거래를 매일 한 번 영구 삭제한다(#9, IA 5절 1번). 대상 판정은 시각 비교라 장부 시간대를 쓰지
 * 않는다. 작업이 도는 날만 Asia/Seoul로 정한다. 그래서 실제 삭제는 {@code deletedAt + 30일}부터 최대 하루 늦다.
 *
 * <p>사람이 한 완전 삭제({@link TransactionService#purge})와 같이 거래, 라인, 이력을 지우고 기록 한 행만 남긴다. 기록은
 * 바꾼 사람이 없고 action이 {@link ChangeAction#AUTO_PURGE}다(ADR 007 결정 6). 정해진 건수씩 각자의 트랜잭션에서 지운다.
 * 지운 거래는 다시 대상이 되지 않으므로 두 번 돌아도 결과가 같다. 로그에는 건수만 남긴다.
 *
 * <p>공개 메서드가 없다. 스케줄러만 부르고 API가 부를 수 없게 한다(ServiceMethodInventoryTest).
 */
@Component
public class TrashAutoPurge {

    /** 휴지통에 두는 기간(IA 5절 1번). 응답의 {@code purgeAt}도 이 값으로 계산한다. */
    public static final Duration RETENTION = Duration.ofDays(30);

    /** 매일 04:00. 설정 {@code accountbook.trash-purge.cron}으로 바꾸고 {@code -}로 끈다(테스트). */
    static final String CRON = "0 0 4 * * *";
    static final String ZONE = "Asia/Seoul";
    static final int BATCH_SIZE = 500;

    private static final Logger log = LoggerFactory.getLogger(TrashAutoPurge.class);

    private final TransactionPurgeRepository purgeRepository;
    private final ChangeLogRepository changeLogRepository;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;

    TrashAutoPurge(TransactionPurgeRepository purgeRepository, ChangeLogRepository changeLogRepository,
                   TransactionTemplate transactionTemplate, Clock clock) {
        this.purgeRepository = purgeRepository;
        this.changeLogRepository = changeLogRepository;
        this.transactionTemplate = transactionTemplate;
        this.clock = clock;
    }

    @Scheduled(cron = "${accountbook.trash-purge.cron:" + CRON + "}", zone = ZONE)
    void run() {
        int purged = purgeExpired(clock.instant().truncatedTo(ChronoUnit.MICROS), BATCH_SIZE);
        log.info("trash auto purge: {} transactions", purged);
    }

    /**
     * {@code now - 30일} 이전(같은 시각 포함)에 휴지통에 넣은 거래를 모두 지운다.
     *
     * @param now 기록 행의 시각이기도 하다
     * @return 지운 거래 수
     */
    int purgeExpired(Instant now, int batchSize) {
        Instant cutoff = now.minus(RETENTION);
        int total = 0;
        int purged;
        do {
            purged = Objects.requireNonNull(transactionTemplate.execute(status -> purgeBatch(cutoff, now, batchSize)));
            total += purged;
        } while (purged == batchSize);
        return total;
    }

    private int purgeBatch(Instant cutoff, Instant now, int batchSize) {
        List<TransactionPurgeRepository.Expired> expired = purgeRepository.lockExpired(cutoff, batchSize);
        if (expired.isEmpty()) {
            return 0;
        }
        List<UUID> ids = expired.stream().map(TransactionPurgeRepository.Expired::getId).toList();
        purgeRepository.deleteLogs(ids);
        purgeRepository.deleteTransactions(ids);
        expired.forEach(tx -> changeLogRepository.save(ChangeLog.of(tx.getId(), tx.getLedgerId(),
                tx.getVersion() + 1, ChangeAction.AUTO_PURGE, null, null, null, null, now)));
        return expired.size();
    }
}
