package app.accountbook.account;

import app.accountbook.common.DuplicateAccountNameException;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerAccess;
import java.util.List;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    /** V6 마이그레이션의 유니크 제약 이름. */
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_account_name";

    /** 시작 잔액 크기의 상한(P-201의 최대값, F-502). DB의 ck_account_opening_balance_range와 같은 값이다. */
    private static final long MAX_OPENING_BALANCE = 9_999_999_999L;

    private final AccountRepository accountRepository;
    private final AccountUsage accountUsage;
    private final LedgerAccess ledgerAccess;

    AccountService(AccountRepository accountRepository, AccountUsage accountUsage,
                   LedgerAccess ledgerAccess) {
        this.accountRepository = accountRepository;
        this.accountUsage = accountUsage;
        this.ledgerAccess = ledgerAccess;
    }

    /**
     * 이름은 앞뒤 공백을 지운 1~50자이고 같은 장부 안에서 겹칠 수 없다(P-220).
     * 시작 잔액은 음수도 되고 크기는 9,999,999,999원까지다(F-502).
     */
    @Transactional
    public Account create(UUID actorId, UUID ledgerId, AccountCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        String name = validateAndNormalizeName(cmd);
        Account account = Account.of(ledgerId, name, cmd.type(), cmd.openingBalance(), cmd.openingDate());
        requireUniqueName(account, name);
        return saveUnlessDuplicate(account);
    }

    @Transactional
    public Account update(UUID actorId, UUID accountId, AccountCommand cmd) {
        Account account = loadForMember(actorId, accountId);
        String name = validateAndNormalizeName(cmd);
        requireUniqueName(account, name);
        account.update(name, cmd.type(), cmd.openingBalance(), cmd.openingDate());
        return saveUnlessDuplicate(account);
    }

    /** 라인이 참조하는 계좌(소프트 삭제된 거래 포함)는 지울 수 없다. */
    @Transactional
    public void delete(UUID actorId, UUID accountId) {
        Account account = loadForMember(actorId, accountId);
        if (accountUsage.isUsed(accountId)) {
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

    /** 자기 자신과는 겹치지 않는 것으로 본다. 이름은 글자 그대로 비교한다(대소문자, 가운데 공백 구분). */
    private void requireUniqueName(Account account, String name) {
        if (accountRepository.existsByLedgerIdAndNameAndIdNot(account.getLedgerId(), name, account.getId())) {
            throw new DuplicateAccountNameException();
        }
    }

    /**
     * 바로 flush해서 DB 제약 위반을 이 메서드 안에서 받는다.
     * 동시 요청이 둘 다 앱 검사를 통과하면 나중 것이 유니크 제약에 걸리는데, 그것도 같은 이름 오류로 알린다.
     */
    private Account saveUnlessDuplicate(Account account) {
        try {
            return accountRepository.saveAndFlush(account);
        } catch (DataIntegrityViolationException e) {
            if (e.getCause() instanceof ConstraintViolationException violation
                    && NAME_UNIQUE_CONSTRAINT.equals(violation.getConstraintName())) {
                throw new DuplicateAccountNameException();
            }
            throw e;
        }
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
        // Math.abs는 Long.MIN_VALUE에서 음수를 돌려주므로 양 끝과 직접 비교한다.
        if (cmd.openingBalance() < -MAX_OPENING_BALANCE || cmd.openingBalance() > MAX_OPENING_BALANCE) {
            throw new InvalidRequestException(
                    "시작 잔액은 -9,999,999,999원부터 9,999,999,999원까지 입력할 수 있습니다.");
        }
        return Names.normalize(cmd.name());
    }
}
