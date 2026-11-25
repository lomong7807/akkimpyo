package app.accountbook.account;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AccountRepository extends JpaRepository<Account, UUID> {

    List<Account> findByLedgerIdOrderByCreatedAtAsc(UUID ledgerId);

    /** 같은 장부에 같은 이름의 다른 계좌가 있는가. */
    boolean existsByLedgerIdAndNameAndIdNot(UUID ledgerId, String name, UUID selfId);
}
