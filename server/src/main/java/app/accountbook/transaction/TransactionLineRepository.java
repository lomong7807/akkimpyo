package app.accountbook.transaction;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TransactionLineRepository extends JpaRepository<TransactionLine, UUID> {

    /** 소프트 삭제·취소된 거래의 라인도 포함한다. */
    boolean existsByAccountId(UUID accountId);

    /** 소프트 삭제·취소된 거래의 라인도 포함한다. */
    boolean existsByCategoryId(UUID categoryId);
}
