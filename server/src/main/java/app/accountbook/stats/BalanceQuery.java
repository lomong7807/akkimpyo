package app.accountbook.stats;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.transaction.TransactionStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.math.BigInteger;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 계좌 잔액 = 기준 잔액 + 기준일(포함) 이후 거래 라인의 합.
 * 삭제되거나 취소(CANCELED)된 거래의 라인은 빠진다. 합계는 DB가 계산한다.
 * 합계나 잔액이 long을 넘으면 틀린 값 대신 {@link ArithmeticException}이 난다. DB의 합계는 numeric이라 넘치지 않으며,
 * Long으로 바로 읽으면 드라이버의 예외 메시지에 금액이 들어가므로 BigInteger로 읽어 바꾼다.
 * 라인과 거래에 장부 조건을 각각 건다. 조인으로만 장부를 좁히면 큰 장부에서 느리다(docs/db/schema-standards.md 4절).
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
        BigInteger lineSum = entityManager.createQuery("""
                        select cast(coalesce(sum(l.amount), 0L) as BigInteger)
                          from TransactionLine l
                          join l.transaction t
                         where l.accountId = :accountId
                           and t.occurredOn >= :openingDate
                           and t.deletedAt is null
                           and t.status <> :canceled
                           and l.ledgerId = :ledgerId
                           and t.ledgerId = :ledgerId
                        """, BigInteger.class)
                .setParameter("accountId", accountId)
                .setParameter("openingDate", account.getOpeningDate())
                .setParameter("canceled", TransactionStatus.CANCELED)
                .setParameter("ledgerId", account.getLedgerId())
                .getSingleResult();
        return Math.addExact(account.getOpeningBalance(), lineSum.longValueExact());
    }

    /** 장부의 모든 계좌(거래가 없는 계좌 포함)의 잔액. */
    public Map<UUID, Long> balances(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Map<UUID, Long> lineSums = entityManager.createQuery("""
                        select l.accountId, cast(sum(l.amount) as BigInteger)
                          from TransactionLine l
                          join l.transaction t
                          join Account a on a.id = l.accountId
                         where l.ledgerId = :ledgerId
                           and t.ledgerId = :ledgerId
                           and t.occurredOn >= a.openingDate
                           and t.deletedAt is null
                           and t.status <> :canceled
                         group by l.accountId
                        """, Tuple.class)
                .setParameter("ledgerId", ledgerId)
                .setParameter("canceled", TransactionStatus.CANCELED)
                .getResultList().stream()
                .collect(Collectors.toMap(row -> row.get(0, UUID.class),
                        row -> row.get(1, BigInteger.class).longValueExact()));
        return accountRepository.findByLedgerIdOrderByCreatedAtAsc(ledgerId).stream()
                .collect(Collectors.toMap(Account::getId,
                        account -> Math.addExact(account.getOpeningBalance(),
                                lineSums.getOrDefault(account.getId(), 0L))));
    }
}
