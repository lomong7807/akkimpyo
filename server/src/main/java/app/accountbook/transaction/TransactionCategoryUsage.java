package app.accountbook.transaction;

import app.accountbook.category.CategoryUsage;
import app.accountbook.common.Times;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.hibernate.Session;
import org.springframework.stereotype.Component;

/** 카테고리 삭제(F-512)의 거래 쪽 일. 부른 쪽의 트랜잭션에 참여한다. 문장 수는 옮기는 거래 수와 상관없다. */
@Component
class TransactionCategoryUsage implements CategoryUsage {

    /** 이력을 JDBC 묶음 하나로 보내는 행 수. */
    static final int LOG_BATCH_SIZE = 500;

    private final TransactionRepository transactionRepository;
    private final TransactionLineRepository lineRepository;
    private final ChangeLogRepository changeLogRepository;
    private final EntityManager entityManager;

    TransactionCategoryUsage(TransactionRepository transactionRepository, TransactionLineRepository lineRepository,
                             ChangeLogRepository changeLogRepository, EntityManager entityManager) {
        this.transactionRepository = transactionRepository;
        this.lineRepository = lineRepository;
        this.changeLogRepository = changeLogRepository;
        this.entityManager = entityManager;
    }

    @Override
    public long countTransactions(UUID ledgerId, Set<UUID> categoryIds) {
        return lineRepository.countTransactionsUsingCategories(ledgerId, categoryIds);
    }

    /**
     * 거래를 먼저 잠그고 다음 문장에서 라인과 함께 읽는다. 잠그며 기다린 커밋도 읽는 문장은 본다. 그 뒤로 그 거래들은 바뀌지 않아,
     * 읽은 거래와 version을 올리고 라인을 옮기는 거래가 같다. 이력 시각은 거래마다 엄격히 증가한다(TransactionService와 같다).
     */
    @Override
    public void moveLines(UUID ledgerId, Set<UUID> categoryIds, UUID targetCategoryId, UUID movedBy,
                          String deviceId) {
        DeviceIds.requireValidFormat(deviceId);
        entityManager.flush(); // 아래에서 떼어 낼 거래에 보내지 않은 변경이 없게 한다.
        transactionRepository.lockUsingCategories(ledgerId, categoryIds);
        List<Transaction> moving = transactionRepository.findWithLinesUsingCategories(ledgerId, categoryIds);
        if (moving.isEmpty()) {
            return;
        }
        Map<UUID, Instant> lastLogAt = changeLogRepository.findLastLogTimes(ledgerId, categoryIds).stream()
                .collect(Collectors.toMap(ChangeLogRepository.LastLogTime::getTransactionId,
                        ChangeLogRepository.LastLogTime::getLastAt));
        Instant now = Times.now();
        int advanced = transactionRepository.advanceVersionsUsingCategories(ledgerId, categoryIds, now);
        if (advanced != moving.size()) {
            throw new IllegalStateException("잠근 거래 " + moving.size() + "건 가운데 " + advanced + "건의 version을 올렸습니다.");
        }
        lineRepository.moveCategory(ledgerId, categoryIds, targetCategoryId);
        List<ChangeLog> logs = moving.stream().map(tx -> {
            ChangeLogValue before = ChangeLogValue.of(tx);
            ChangeLogValue after = before.withCategoryMoved(categoryIds, targetCategoryId, now);
            return ChangeLog.of(tx.getId(), ledgerId, after.version(), ChangeAction.CATEGORY_MOVE, movedBy, deviceId,
                    before, after, logTime(now, lastLogAt.get(tx.getId())));
        }).toList();
        moving.forEach(entityManager::detach); // DB보다 낡았다. 다시 찾으면 DB에서 읽게 한다.
        saveInBatch(logs);
    }

    private static Instant logTime(Instant now, Instant last) {
        return last == null || now.isAfter(last) ? now : last.plus(1, ChronoUnit.MICROS);
    }

    /** 이 세션에서만 JDBC 묶음을 켜고 바로 flush한다. 앱 전체의 설정은 바꾸지 않는다. */
    private void saveInBatch(List<ChangeLog> logs) {
        Session session = entityManager.unwrap(Session.class);
        Integer previous = session.getJdbcBatchSize();
        session.setJdbcBatchSize(LOG_BATCH_SIZE);
        try {
            logs.forEach(changeLogRepository::save);
            entityManager.flush();
        } finally {
            session.setJdbcBatchSize(previous);
        }
    }
}
