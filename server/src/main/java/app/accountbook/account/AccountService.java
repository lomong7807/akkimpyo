package app.accountbook.account;

import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.transaction.TransactionLineRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    private final AccountRepository accountRepository;
    private final TransactionLineRepository lineRepository;
    private final LedgerAccess ledgerAccess;

    AccountService(AccountRepository accountRepository, TransactionLineRepository lineRepository,
                   LedgerAccess ledgerAccess) {
        this.accountRepository = accountRepository;
        this.lineRepository = lineRepository;
        this.ledgerAccess = ledgerAccess;
    }

    @Transactional
    public Account create(UUID actorId, UUID ledgerId, AccountCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        String name = validateAndNormalizeName(cmd);
        return accountRepository.save(
                Account.of(ledgerId, name, cmd.type(), cmd.openingBalance(), cmd.openingDate()));
    }

    @Transactional
    public Account update(UUID actorId, UUID accountId, AccountCommand cmd) {
        Account account = loadForMember(actorId, accountId);
        String name = validateAndNormalizeName(cmd);
        account.update(name, cmd.type(), cmd.openingBalance(), cmd.openingDate());
        return account;
    }

    /** 라인이 참조하는 계좌(소프트 삭제된 거래 포함)는 지울 수 없다. */
    @Transactional
    public void delete(UUID actorId, UUID accountId) {
        Account account = loadForMember(actorId, accountId);
        if (lineRepository.existsByAccountId(accountId)) {
            throw new InUseException("거래가 있는 계좌는 지울 수 없습니다.");
        }
        accountRepository.delete(account);
    }

    @Transactional(readOnly = true)
    public List<Account> list(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        return accountRepository.findByLedgerIdOrderByCreatedAtAsc(ledgerId);
    }

    /** 없는 계좌도 구성원이 아닌 것과 같은 예외로 알려 다른 장부 계좌의 존재를 드러내지 않는다. */
    private Account loadForMember(UUID actorId, UUID accountId) {
        Account account = accountRepository.findById(accountId).orElseThrow(NotLedgerMemberException::new);
        ledgerAccess.requireMember(actorId, account.getLedgerId());
        return account;
    }

    /** 요청을 검증하고 공백을 지운 이름을 돌려준다. */
    private static String validateAndNormalizeName(AccountCommand cmd) {
        if (cmd == null) {
            throw new InvalidRequestException("계좌 정보가 없습니다.");
        }
        if (cmd.type() == null) {
            throw new InvalidRequestException("계좌 종류가 없습니다.");
        }
        if (cmd.openingDate() == null) {
            throw new InvalidRequestException("기준일이 없습니다.");
        }
        return Names.normalize(cmd.name());
    }
}
