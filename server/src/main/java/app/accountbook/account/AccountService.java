package app.accountbook.account;

import app.accountbook.common.AccountHasTransactionsException;
import app.accountbook.common.DuplicateAccountNameException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    /** V6 마이그레이션의 유니크 제약 이름. */
    private static final String NAME_UNIQUE_CONSTRAINT = "uq_account_name";

    /** V12 마이그레이션의 거래 라인 → 계좌 FK 이름. */
    private static final String LINE_ACCOUNT_CONSTRAINT = "fk_transaction_line_account";

    /** 시작 잔액 크기의 상한(P-201의 최대값, F-502). DB의 ck_account_opening_balance_range와 같은 값이다. */
    private static final long MAX_OPENING_BALANCE = 9_999_999_999L;

    private final AccountRepository accountRepository;
    private final AccountUsage accountUsage;
    private final LedgerAccess ledgerAccess;
    private final LedgerRepository ledgerRepository;
    private final Clock clock;

    AccountService(AccountRepository accountRepository, AccountUsage accountUsage,
                   LedgerAccess ledgerAccess, LedgerRepository ledgerRepository, Clock clock) {
        this.accountRepository = accountRepository;
        this.accountUsage = accountUsage;
        this.ledgerAccess = ledgerAccess;
        this.ledgerRepository = ledgerRepository;
        this.clock = clock;
    }

    /**
     * 이름은 앞뒤 공백을 지운 1~50자이고 같은 장부 안에서 겹칠 수 없다(P-220).
     * 시작 잔액은 음수도 되고 크기는 9,999,999,999원까지다(F-502).
     * 기준일은 거래 날짜와 같은 범위다(P-206).
     * 틀린 입력란은 모두 한 번에 알리고, 같은 이름은 나머지가 모두 맞을 때만 본다(#13).
     */
    @Transactional
    public Account create(UUID actorId, UUID ledgerId, AccountCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        String name = validateAndNormalizeName(ledgerId, cmd);
        Account account = Account.of(ledgerId, name, cmd.type(), cmd.openingBalance(), cmd.openingDate());
        requireUniqueName(account, name);
        return saveUnlessDuplicate(account);
    }

    /**
     * 이름, 종류, 시작 잔액, 기준일을 바꾼다(F-503). 검증은 만들기와 같고, 이름은 자기 자신과는 겹치지 않는 것으로 본다.
     * version은 없고 나중 저장이 덮어쓴다(P-217). 그 장부의 계좌가 아니면(내가 구성원인 다른 장부의 계좌, 없는 계좌)
     * 구성원이 아닌 것과 같은 예외이고, 검증보다 먼저다. 계좌의 장부는 바뀌지 않는다({@code ledger_id}는 고칠 수 없다).
     */
    @Transactional
    public Account update(UUID actorId, UUID ledgerId, UUID accountId, AccountCommand cmd) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Account account = loadInLedger(ledgerId, accountId);
        String name = validateAndNormalizeName(ledgerId, cmd);
        requireUniqueName(account, name);
        account.update(name, cmd.type(), cmd.openingBalance(), cmd.openingDate());
        return saveUnlessDuplicate(account);
    }

    /**
     * 숨기기({@code hidden=true}, F-506)와 다시 보이기({@code false}, F-507). 이미 그 상태여도 그대로 돌려준다. 거래가 있는
     * 계좌도 숨길 수 있다(P-220). 숨긴 계좌는 새 거래에 고를 수 없고 과거 거래와 잔액·통계에는 남는다. version은 없고
     * 나중 저장이 덮어쓴다(P-217, {@link #update}와 같다). 그 장부의 계좌가 아니면 구성원이 아닌 것과 같은 예외이고,
     * 값이 없는 것({@code null}, {@code hidden}의 {@code REQUIRED})보다 먼저다.
     */
    @Transactional
    public Account setHidden(UUID actorId, UUID ledgerId, UUID accountId, Boolean hidden) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Account account = loadInLedger(ledgerId, accountId);
        if (hidden == null) {
            throw new InvalidRequestException("hidden", FieldErrorCode.REQUIRED, "숨길지 정하는 값이 없습니다.");
        }
        account.setHidden(hidden);
        return account;
    }

    /**
     * 거래가 하나도 없는 계좌만 지운다(F-508, P-220). 라인이 참조하면(휴지통·취소한 거래, 이체의 받는 쪽 포함) 지우지 않는다.
     * 확인한 뒤 지우기 전에 그 계좌로 거래가 저장되면 DB FK에 걸리는데, 그것도 같은 예외로 알린다. 그 장부의 계좌가
     * 아니면(다른 장부의 계좌, 없는 계좌, 이미 지운 계좌) 구성원이 아닌 것과 같은 예외다.
     */
    @Transactional
    public void delete(UUID actorId, UUID ledgerId, UUID accountId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        Account account = loadInLedger(ledgerId, accountId);
        if (accountUsage.isUsed(accountId)) {
            throw new AccountHasTransactionsException();
        }
        try {
            accountRepository.delete(account);
            accountRepository.flush();
        } catch (DataIntegrityViolationException e) {
            if (e.getCause() instanceof ConstraintViolationException violation
                    && LINE_ACCOUNT_CONSTRAINT.equals(violation.getConstraintName())) {
                throw new AccountHasTransactionsException();
            }
            throw e;
        }
    }

    @Transactional(readOnly = true)
    public List<Account> list(UUID actorId, UUID ledgerId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        return accountRepository.findByLedgerIdOrderByCreatedAtAscIdAsc(ledgerId);
    }

    /** 내가 구성원인 다른 장부의 계좌와 없는 계좌는 구성원이 아닌 것과 같은 예외다. 구성원 확인 뒤에 부른다. */
    private Account loadInLedger(UUID ledgerId, UUID accountId) {
        return accountRepository.findById(accountId)
                .filter(found -> found.getLedgerId().equals(ledgerId))
                .orElseThrow(NotLedgerMemberException::new);
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

    /** 요청을 검증하고 공백을 지운 이름을 돌려준다. 입력란마다 보고 틀린 것을 모두 모아 알린다. */
    private String validateAndNormalizeName(UUID ledgerId, AccountCommand cmd) {
        if (cmd == null) {
            throw new InvalidRequestException(InvalidRequestException.WHOLE_BODY, FieldErrorCode.REQUIRED,
                    "계좌 정보가 없습니다.");
        }
        List<InvalidRequestException> errors = new ArrayList<>();
        String name = collect(errors, () -> Names.normalize(cmd.name()));
        if (cmd.type() == null) {
            errors.add(new InvalidRequestException("type", FieldErrorCode.REQUIRED, "계좌 종류가 없습니다."));
        }
        Long openingBalance = cmd.openingBalance();
        if (openingBalance == null) {
            errors.add(new InvalidRequestException("openingBalance", FieldErrorCode.REQUIRED, "시작 잔액이 없습니다."));
        } else if (openingBalance < -MAX_OPENING_BALANCE || openingBalance > MAX_OPENING_BALANCE) {
            // Math.abs는 Long.MIN_VALUE에서 음수를 돌려주므로 양 끝과 직접 비교한다.
            errors.add(new InvalidRequestException("openingBalance", FieldErrorCode.OUT_OF_RANGE,
                    "시작 잔액은 -9,999,999,999원부터 9,999,999,999원까지 입력할 수 있습니다."));
        }
        if (cmd.openingDate() == null) {
            errors.add(new InvalidRequestException("openingDate", FieldErrorCode.REQUIRED, "기준일이 없습니다."));
        } else {
            collect(errors, () -> {
                requireOpeningDateInRange(ledgerId, cmd.openingDate());
                return null;
            });
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return name;
    }

    /** 규칙을 지나면 그 값을, 거부되면 오류를 모으고 null을 돌려준다. */
    private static <T> T collect(List<InvalidRequestException> errors, Supplier<T> rule) {
        try {
            return rule.get();
        } catch (InvalidRequestException e) {
            errors.add(e);
            return null;
        }
    }

    /** "오늘"은 서버 시계의 지금을 그 장부의 시간대로 본 날짜다(P-202). */
    private void requireOpeningDateInRange(UUID ledgerId, LocalDate openingDate) {
        ZoneId ledgerZone = ledgerRepository.findById(ledgerId)
                .map(Ledger::zoneId)
                .orElseThrow(NotFoundException::new);
        LedgerDates.requireInRange("openingDate", "기준일은", openingDate, clock, ledgerZone);
    }
}
