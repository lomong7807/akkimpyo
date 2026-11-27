package app.accountbook.support;

import app.accountbook.account.Account;
import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryRepository;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.transaction.ChangeAction;
import app.accountbook.transaction.Transaction;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionRepository;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import app.accountbook.user.UserService;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.jdbc.core.JdbcTemplate;

/** 서비스 테스트에서 반복되는 준비 작업. {@link IntegrationTest}가 등록한다. */
@TestComponent
public class Fixtures {

    private static final String DEVICE = "test-device";

    private final UserService userService;
    private final AccountService accountService;
    private final TransactionService transactionService;
    private final LedgerMemberRepository memberRepository;
    private final TransactionRepository transactionRepository;
    private final CategoryRepository categoryRepository;
    private final JdbcTemplate jdbc;

    Fixtures(UserService userService, AccountService accountService, TransactionService transactionService,
             LedgerMemberRepository memberRepository, TransactionRepository transactionRepository,
             CategoryRepository categoryRepository, JdbcTemplate jdbc) {
        this.userService = userService;
        this.accountService = accountService;
        this.transactionService = transactionService;
        this.memberRepository = memberRepository;
        this.transactionRepository = transactionRepository;
        this.categoryRepository = categoryRepository;
        this.jdbc = jdbc;
    }

    /**
     * 가입한 사용자: 사용자, 개인 장부, OWNER 구성원이 생긴다. 카테고리는 지출과 수입의 미분류만 남긴다.
     * 가입이 만드는 기본 카테고리 15개(P-223)는 지운다. 테스트가 "식비", "급여" 같은 이름으로 직접 만드는
     * 카테고리와 겹치지 않게 하기 위해서다. 기본 카테고리 자체는 UserServiceTest가 본다.
     */
    public User user(String email) {
        User user = userService.createUser(email, "password1", email.substring(0, email.indexOf('@')));
        categoryRepository.deleteAll(categoryRepository.findByLedgerIdOrderByCreatedAtAsc(personalLedgerId(user))
                .stream()
                .filter(category -> !category.isSystem())
                .toList());
        categoryRepository.flush();
        return user;
    }

    /** 가입 시 생긴 개인 장부(그 사용자가 OWNER인 장부)의 id. */
    public UUID personalLedgerId(User user) {
        return memberRepository.findByUserId(user.getId()).stream()
                .filter(member -> member.getRole() == LedgerRole.OWNER)
                .map(LedgerMember::getLedgerId)
                .findFirst()
                .orElseThrow();
    }

    /** 초대 기능(2단계) 없이 장부에 구성원을 직접 넣는다. */
    public void addMember(UUID ledgerId, User user, LedgerRole role) {
        memberRepository.save(LedgerMember.of(ledgerId, user.getId(), role));
    }

    /**
     * 거래 서비스를 거치지 않고 리포지토리로 지출 1건(라인 amount = -amount)을 저장한다.
     * 계좌·카테고리 삭제 제한처럼 "라인이 있다"는 상태만 필요한 테스트용이다.
     */
    public Transaction storedExpense(User actor, UUID ledgerId, UUID accountId, UUID categoryId, long amount) {
        Transaction tx = Transaction.of(UUID.randomUUID(), ledgerId, TransactionType.EXPENSE,
                LocalDate.of(2026, 11, 18), null, null, null, actor.getId(), actor.getId());
        tx.addLine(accountId, categoryId, -amount);
        return transactionRepository.save(tx);
    }

    public Account account(User actor, UUID ledgerId, String name, AccountType type, long openingBalance,
                           LocalDate openingDate) {
        return accountService.create(actor.getId(), ledgerId,
                new AccountCommand(name, type, openingBalance, openingDate));
    }

    /** 지출. categoryId가 null이면 미분류. */
    public TransactionView expense(User actor, UUID ledgerId, UUID accountId, UUID categoryId, LocalDate on,
                                   long amount) {
        return entry(actor, ledgerId, TransactionType.EXPENSE, false, accountId, categoryId, on, amount);
    }

    /** 환불: 지출 카테고리에 양수 라인. */
    public TransactionView refund(User actor, UUID ledgerId, UUID accountId, UUID categoryId, LocalDate on,
                                  long amount) {
        return entry(actor, ledgerId, TransactionType.EXPENSE, true, accountId, categoryId, on, amount);
    }

    /** 수입. categoryId가 null이면 미분류. */
    public TransactionView income(User actor, UUID ledgerId, UUID accountId, UUID categoryId, LocalDate on,
                                  long amount) {
        return entry(actor, ledgerId, TransactionType.INCOME, false, accountId, categoryId, on, amount);
    }

    public TransactionView transfer(User actor, UUID ledgerId, UUID fromAccountId, UUID toAccountId, LocalDate on,
                                    long amount) {
        return transactionService.create(actor.getId(), ledgerId,
                new TransactionCommand.Transfer(UUID.randomUUID(), on, null, fromAccountId, toAccountId, amount,
                        null), DEVICE);
    }

    public TransactionView cancel(User actor, TransactionView tx) {
        return transactionService.cancel(actor.getId(), tx.id(), tx.version(), DEVICE);
    }

    public TransactionView delete(User actor, TransactionView tx) {
        return transactionService.delete(actor.getId(), tx.id(), tx.version(), DEVICE);
    }

    /**
     * 거래를 완전히 지운 기록 한 행을 DB에 바로 넣는다. 완전 삭제 기능(#9)이 아직 없어 그 결과만 만든다.
     * 만들고(1) 휴지통에 넣고(2) 완전히 지운(3) 거래라 번호가 3이고, 전후 값과 기기 값이 없다(ADR 007 결정 2, 7).
     */
    public void purgeRecord(UUID transactionId, UUID ledgerId, ChangeAction action, UUID actorId) {
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, actor_id, created_at)
                values (?, ?, ?, 3, ?, ?, now())
                """, UUID.randomUUID(), transactionId, ledgerId, action.name(), actorId);
    }

    /**
     * 완전 삭제(#9)가 한 트랜잭션에서 할 일을 DB에 바로 한다. 기능이 아직 없어서다. 그 거래의 이력과 거래를 지우고
     * (라인은 거래와 같이 지워진다) 기록 한 행만 남긴다. 기록의 번호는 지우기 전 거래의 version + 1이다(ADR 007 결정 2, 7).
     */
    public void purge(UUID transactionId, UUID actorId) {
        Map<String, Object> tx = jdbc.queryForMap("select ledger_id, version from transaction where id = ?",
                transactionId);
        jdbc.update("delete from change_log where transaction_id = ?", transactionId);
        jdbc.update("delete from transaction where id = ?", transactionId);
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, actor_id, created_at)
                values (?, ?, ?, ?, ?, ?, now())
                """, UUID.randomUUID(), transactionId, tx.get("ledger_id"), (Long) tx.get("version") + 1,
                ChangeAction.PURGE.name(), actorId);
    }

    private TransactionView entry(User actor, UUID ledgerId, TransactionType type, boolean refund, UUID accountId,
                                  UUID categoryId, LocalDate on, long amount) {
        return transactionService.create(actor.getId(), ledgerId,
                new TransactionCommand.Entry(UUID.randomUUID(), type, on, null, accountId, categoryId, amount,
                        refund, null, null, null), DEVICE);
    }
}
