package app.accountbook.transaction;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BinaryOperator;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 읽은 거래 여럿의 읽기 모델. 고친 사람은 거래마다 읽은 version까지의 마지막 이력을 남긴 사람이다(ADR 002 2절).
 * {@code TransactionService}가 거래 하나에 쓰는 규칙과 같고, 거래 수와 무관하게 한 문장으로 읽는다. 이력은 거래 id로 찾으므로
 * 장부 조건을 걸지 않는다(docs/db/schema-standards.md 4절). {@link TransactionListQuery}에도 같은 규칙이 있다.
 */
final class TransactionViews {

    private TransactionViews() {
    }

    /** 읽은 순서 그대로. 탈퇴로 비워진 고친 사람은 null이다. */
    static List<TransactionView> of(EntityManager entityManager, List<Transaction> txs) {
        if (txs.isEmpty()) {
            return List.of();
        }
        Map<UUID, Long> versions = txs.stream().collect(Collectors.toMap(Transaction::getId, Transaction::getVersion));
        Map<UUID, Edit> edits = entityManager.createQuery("""
                        select c.transactionId, c.version, c.actorId from ChangeLog c
                         where c.transactionId in :ids
                        """, Tuple.class)
                .setParameter("ids", versions.keySet())
                .getResultList().stream()
                .map(row -> new Edit(row.get(0, UUID.class), row.get(1, Long.class), row.get(2, UUID.class)))
                .filter(edit -> edit.version() <= versions.get(edit.transactionId()))
                .collect(Collectors.toMap(Edit::transactionId, Function.identity(),
                        BinaryOperator.maxBy(Comparator.comparingLong(Edit::version))));
        return txs.stream()
                .map(tx -> TransactionView.of(tx, Optional.ofNullable(edits.get(tx.getId()))
                        .map(Edit::actorId)
                        .orElse(null)))
                .toList();
    }

    /** @param actorId 탈퇴로 비워졌으면 null */
    private record Edit(UUID transactionId, long version, UUID actorId) {
    }
}
