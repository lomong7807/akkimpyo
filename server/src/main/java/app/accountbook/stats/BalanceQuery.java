package app.accountbook.stats;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.transaction.TransactionStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 계좌 잔액 = 기준 잔액 + 기준일(포함) 이후 거래 라인의 합.
 * 삭제되거나 취소(CANCELED)된 거래의 라인은 빠진다. 합계는 DB가 계산한다.
 */
@Component
@Transactional(readOnly = true)
public class BalanceQuery {

    private final EntityManager entityManager;
    private final AccountRepository accountRepository;
    private final LedgerAccess ledgerAccess;

    BalanceQuery(EntityManager entityManager, AccountRepository accountRepository, LedgerAccess ledgerAccess) {
        this.entityManager = entityManager;
        this.accountRepository = accountRepository;
        this.ledgerAccess = ledgerAccess;
    }

    public long balance(UUID actorId, UUID accountId) {
        Account account = accountRepository.findById(accountId).orElseThrow(NotLedgerMemberException::new);
        ledgerAccess.requireMember(actorId, account.getLedgerId());
        Long lineSum = entityManager.createQuery("""
                        select coalesce(sum(l.amount), 0L)
                          from TransactionLine l
                          join l.transaction t
                         where l.accountId = :accountId
                           and t.occurredOn >= :openingDate
                           and t.deletedAt is null
                           and t.status <> :canceled
                        """, Long.class)
                .setParameter("accountId", accountId)
                .setParameter("openingDate", account.getOpeningDate())
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getSingleResult();
        return account.getOpeningBalance() + lineSum;
    }

    /** 장부의 모든 계좌(거래가 없는 계좌 포함)의 잔액. */
    public Map<UUID, Long> balances(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Map<UUID, Long> lineSums = entityManager.createQuery("""
                        select l.accountId, sum(l.amount)
                          from TransactionLine l
                          join l.transaction t
                          join Account a on a.id = l.accountId
                         where a.ledgerId = :ledgerId
                           and t.occurredOn >= a.openingDate
                           and t.deletedAt is null
                           and t.status <> :canceled
                         group by l.accountId
                        """, Tuple.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getResultList().stream()
                .collect(Collectors.toMap(row -> row.get(0, UUID.class), row -> row.get(1, Long.class)));
        return accountRepository.findByLedgerIdOrderByCreatedAtAsc(ledgerId).stream()
                .collect(Collectors.toMap(Account::getId,
                        account -> account.getOpeningBalance() + lineSums.getOrDefault(account.getId(), 0L)));
    }
}
