package app.accountbook.transaction;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * 거래 완전 삭제(F-231)와 30일 자동 삭제(#9)만 쓰는 저장소. 이력 행을 지우는 앱 경로는 여기뿐이다(ADR 007 결정 2).
 * 일반 경로의 {@link ChangeLogRepository}는 더하고 읽기만 한다. 라인은 거래를 지우면 FK(ON DELETE CASCADE)로 같이 지워진다.
 */
interface TransactionPurgeRepository extends Repository<ChangeLog, UUID> {

    /** 휴지통에 있고 version이 맞는 거래 하나를 지운다. 그사이 바뀌었거나 이미 지워졌으면 0이다. */
    @Modifying(flushAutomatically = true)
    @Query(value = "delete from transaction where id = :id and version = :version and deleted_at is not null",
            nativeQuery = true)
    int deleteTrashed(UUID id, long version);

    /**
     * 휴지통에 넣은 시각이 {@code cutoff} 이전(같은 시각 포함)인 거래를 오래된 순으로 {@code limit}건 잠근다.
     * 다른 트랜잭션이 잠근 거래(완전 삭제, 복원 중)는 건너뛰고 다음 실행이 다시 본다.
     */
    @Query(value = """
            select id, ledger_id as "ledgerId", version from transaction
             where deleted_at <= :cutoff
             order by deleted_at, id
             limit :limit
               for update skip locked
            """, nativeQuery = true)
    List<Expired> lockExpired(Instant cutoff, int limit);

    @Modifying(flushAutomatically = true)
    @Query(value = "delete from change_log where transaction_id in (:transactionIds)", nativeQuery = true)
    int deleteLogs(Collection<UUID> transactionIds);

    @Modifying(flushAutomatically = true)
    @Query(value = "delete from transaction where id in (:ids)", nativeQuery = true)
    int deleteTransactions(Collection<UUID> ids);

    /** 지울 거래. 기록 행에는 거래 id, 장부 id, 거래 version + 1만 쓴다. */
    interface Expired {

        UUID getId();

        UUID getLedgerId();

        long getVersion();
    }
}
