package app.accountbook.transaction;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.repository.Repository;

/**
 * 이력은 추가만 한다(P-216). 고치거나 지우는 메서드가 딸려 오지 않게 JpaRepository를 잇지 않고 쓰는 것만 적는다.
 */
public interface ChangeLogRepository extends Repository<ChangeLog, UUID> {

    ChangeLog save(ChangeLog log);

    /** 이력의 순서는 시각이 아니라 거래 version이다(ADR 007 결정 7). */
    List<ChangeLog> findByTransactionIdOrderByVersionAsc(UUID transactionId);

    Optional<ChangeLog> findFirstByTransactionIdOrderByVersionDesc(UUID transactionId);

    /** 그 장부의 그 거래 이력, 오래된 것부터. 장부 조건은 거래 id와 함께 건다(이력 조회 API, #47). */
    List<ChangeLog> findByTransactionIdAndLedgerIdOrderByVersionAsc(UUID transactionId, UUID ledgerId);

    /** 그 version까지의 마지막 이력. 전체 복원으로 version에 구멍이 있어도 된다(ADR 006 결정 5). */
    Optional<ChangeLog> findFirstByTransactionIdAndVersionLessThanEqualOrderByVersionDesc(UUID transactionId,
                                                                                         long version);

    /** 장부를 가리지 않는다. 거래 id는 모든 장부에서 하나다. */
    boolean existsByTransactionIdAndActionIn(UUID transactionId, Collection<ChangeAction> actions);
}
