package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import java.util.stream.Stream;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 만들기의 검사 순서(ADR 006 결정 4): 구성원 → 형식 검증 → 같은 id 조회 → 참조 검증 → 저장.
 * 인증과 권한(보기 전용)은 서비스 밖이거나 아직 없어서 여기서는 구성원 확인부터 본다.
 */
@IntegrationTest
class TransactionCreateOrderTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    static final String DEVICE = "iphone.safari";

    @Autowired TransactionService transactionService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired LedgerMemberRepository memberRepository;
    @Autowired Fixtures fixtures;

    User owner;
    UUID ledgerId;
    Account cash;

    User stranger;
    UUID strangerLedgerId;
    Account strangerCash;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OPENING);

        stranger = fixtures.user("stranger@example.com");
        strangerLedgerId = fixtures.personalLedgerId(stranger);
        strangerCash = fixtures.account(stranger, strangerLedgerId, "남의현금", AccountType.CASH, 0, OPENING);
    }

    @Test
    void 구성원_확인이_같은_id_조회보다_먼저다() {
        Entry cmd = expense(UUID.randomUUID(), 12_000, null);
        transactionService.create(owner.getId(), ledgerId, cmd, DEVICE);

        // 구성원이 아닌 사람은 그 장부에 이미 있는 id를 보내도 재전송이나 충돌이 아니라 구성원 아님이다.
        assertThatThrownBy(() -> transactionService.create(stranger.getId(), ledgerId, cmd, DEVICE))
                .isInstanceOf(NotLedgerMemberException.class);
    }

    @Test
    void 저장된_뒤_장부에서_빠진_사람의_재전송은_구성원_아님이다() {
        User member = fixtures.user("member@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        Entry cmd = expense(UUID.randomUUID(), 12_000, null);
        transactionService.create(member.getId(), ledgerId, cmd, DEVICE);
        removeMember(member);

        assertThatThrownBy(() -> transactionService.create(member.getId(), ledgerId, cmd, DEVICE))
                .isInstanceOf(NotLedgerMemberException.class);
    }

    @Test
    void 형식이_틀린_요청은_같은_id가_있어도_형식_오류다() {
        UUID mine = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(mine, 12_000, null), DEVICE);
        UUID others = UUID.randomUUID();
        transactionService.create(stranger.getId(), strangerLedgerId,
                new Entry(others, TransactionType.EXPENSE, DAY, null, strangerCash.getId(), null, 5_000, null,
                        null, null, null), DEVICE);

        // 내 거래의 id든 쓸 수 없는 id든, 형식 검증이 먼저라 충돌이 아니라 입력 오류다.
        assertRejected("amount:OUT_OF_RANGE",
                () -> transactionService.create(owner.getId(), ledgerId, expense(mine, 0, null), DEVICE));
        assertRejected("amount:OUT_OF_RANGE",
                () -> transactionService.create(owner.getId(), ledgerId, expense(others, 0, null), DEVICE));
        assertRejected("accountId:REQUIRED", () -> transactionService.create(owner.getId(), ledgerId,
                new Entry(mine, TransactionType.EXPENSE, DAY, null, null, null, 12_000, null, null, null, null),
                DEVICE));
    }

    @Test
    void 기기_값의_형식이_틀린_요청은_같은_id가_있어도_형식_오류다() {
        Entry mine = expense(UUID.randomUUID(), 12_000, null);
        transactionService.create(owner.getId(), ledgerId, mine, DEVICE);
        UUID others = UUID.randomUUID();
        transactionService.create(stranger.getId(), strangerLedgerId,
                new Entry(others, TransactionType.EXPENSE, DAY, null, strangerCash.getId(), null, 5_000, null,
                        null, null, null), DEVICE);

        // 내용까지 같은 재전송이든 쓸 수 없는 id든, 이미 저장된 거래를 돌려주거나 충돌로 답하지 않는다.
        assertRejected("deviceId:INVALID_FORMAT",
                () -> transactionService.create(owner.getId(), ledgerId, mine, "iphone.safari\n"));
        assertRejected("deviceId:INVALID_FORMAT", () -> transactionService.create(owner.getId(), ledgerId,
                expense(others, 5_000, null), "iphone.safari\n"));
    }

    @Test
    void 재전송은_참조_검증보다_먼저_답한다() {
        User member = fixtures.user("member@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        Entry cmd = expense(UUID.randomUUID(), 12_000, member.getId());
        TransactionView first = transactionService.create(owner.getId(), ledgerId, cmd, DEVICE);
        // 결제한 사람이 그사이 장부에서 빠졌다. 새 거래라면 참조 검증에서 거부되는 요청이다.
        removeMember(member);
        assertRejected("paidBy:NOT_ALLOWED", () -> transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), 12_000, member.getId()), DEVICE));

        TransactionView resent = transactionService.create(owner.getId(), ledgerId, cmd, DEVICE);

        assertThat(resent).isEqualTo(first);
        assertThat(transactionService.history(owner.getId(), cmd.id())).hasSize(1);
    }

    @Test
    void 같은_id의_충돌은_참조_검증보다_먼저_답한다() {
        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(id, 12_000, null), DEVICE);

        // 계좌가 내 장부의 것이 아니지만, 그 전에 같은 id의 다른 내용으로 판정된다.
        assertThatThrownBy(() -> transactionService.create(owner.getId(), ledgerId,
                new Entry(id, TransactionType.EXPENSE, DAY, null, strangerCash.getId(), null, 12_000, null,
                        "김밥천국", null, null), DEVICE))
                .isInstanceOf(IdConflictException.class);
    }

    /** 완전히 지운 id의 확인은 같은 id 조회 자리다: 구성원과 형식 검증 뒤, 참조 검증 앞. */
    @Test
    void 완전히_지운_id는_구성원과_형식을_본_뒤_참조_검증보다_먼저_거부한다() {
        UUID purged = UUID.randomUUID();
        fixtures.purgeRecord(purged, ledgerId, ChangeAction.PURGE, owner.getId());

        assertThatThrownBy(() -> transactionService.create(stranger.getId(), ledgerId, expense(purged, 12_000, null),
                DEVICE))
                .isInstanceOf(NotLedgerMemberException.class);
        assertRejected("amount:OUT_OF_RANGE",
                () -> transactionService.create(owner.getId(), ledgerId, expense(purged, 0, null), DEVICE));
        // 계좌가 내 장부의 것이 아니지만, 그 전에 쓸 수 없는 id로 판정된다.
        assertThatThrownBy(() -> transactionService.create(owner.getId(), ledgerId,
                new Entry(purged, TransactionType.EXPENSE, DAY, null, strangerCash.getId(), null, 12_000, null,
                        "김밥천국", null, null), DEVICE))
                .isInstanceOf(IdConflictException.class);
    }

    @Test
    void 새_id는_참조_검증을_지나야_저장된다() {
        UUID id = UUID.randomUUID();

        assertRejected("accountId:NOT_FOUND", () -> transactionService.create(owner.getId(), ledgerId,
                new Entry(id, TransactionType.EXPENSE, DAY, null, strangerCash.getId(), null, 12_000, null,
                        "김밥천국", null, null), DEVICE));
        assertThat(transactionRepository.existsById(id)).isFalse();
    }

    /**
     * 글자 수, 날짜, 같은 계좌 이체, 이체 금액, 수입의 환불도 같은 id 조회보다 먼저 본다. 만든 뒤 고쳐져 내용을 비교하지 않는
     * 거래(version 2)의 id여도 재전송이 아니라 그 입력란의 형식 오류다(#14 테스트 보강 2).
     */
    @TestFactory
    Stream<DynamicTest> 형식_오류는_고쳐진_거래의_id여도_재전송보다_먼저다() {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, OPENING).getId();
        UUID entryId = UUID.randomUUID();
        UUID transferId = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(entryId, 12_000, null), DEVICE);
        transactionService.update(owner.getId(), entryId, 1, expense(entryId, 13_000, null), DEVICE);
        transactionService.create(owner.getId(), ledgerId,
                new Transfer(transferId, DAY, null, bank, cash.getId(), 5_000, null), DEVICE);
        transactionService.update(owner.getId(), transferId, 1,
                new Transfer(transferId, DAY, null, bank, cash.getId(), 6_000, null), DEVICE);
        return Stream.of(
                rejectedAs("payee:TOO_LONG", new Entry(entryId, TransactionType.EXPENSE, DAY, null, cash.getId(), null,
                        13_000, null, "가".repeat(101), null, null)),
                rejectedAs("memo:TOO_LONG", new Entry(entryId, TransactionType.EXPENSE, DAY, null, cash.getId(), null,
                        13_000, null, null, "가".repeat(501), null)),
                rejectedAs("occurredOn:OUT_OF_RANGE", new Entry(entryId, TransactionType.EXPENSE,
                        LocalDate.of(1999, 12, 31), null, cash.getId(), null, 13_000, null, null, null, null)),
                rejectedAs("refundKind:NOT_ALLOWED", new Entry(entryId, TransactionType.INCOME, DAY, null, cash.getId(),
                        null, 13_000, RefundKind.REFUND, null, null, null)),
                rejectedAs("toAccountId:NOT_ALLOWED",
                        new Transfer(transferId, DAY, null, cash.getId(), cash.getId(), 6_000, null)),
                rejectedAs("amount:OUT_OF_RANGE", new Transfer(transferId, DAY, null, bank, cash.getId(), 0, null)));
    }

    @Test
    void 이체의_계좌_참조_검증은_같은_id_조회보다_뒤다() {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, OPENING).getId();
        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, new Transfer(id, DAY, null, bank, cash.getId(), 5_000,
                null), DEVICE);

        // 받는 계좌가 내 장부의 것이 아니지만, 그 전에 같은 id의 다른 내용으로 판정된다. 새 id면 참조 오류다.
        assertThatThrownBy(() -> transactionService.create(owner.getId(), ledgerId,
                new Transfer(id, DAY, null, bank, strangerCash.getId(), 5_000, null), DEVICE))
                .isInstanceOf(IdConflictException.class);
        assertRejected("toAccountId:NOT_FOUND", () -> transactionService.create(owner.getId(), ledgerId,
                new Transfer(UUID.randomUUID(), DAY, null, bank, strangerCash.getId(), 5_000, null), DEVICE));
    }

    private DynamicTest rejectedAs(String expected, TransactionCommand cmd) {
        return dynamicTest(expected, () -> assertRejected(expected,
                () -> transactionService.createOrReplay(owner.getId(), ledgerId, cmd, DEVICE)));
    }

    /** 형식 오류와 참조 오류를 예외의 종류가 아니라 입력란과 이유로 가린다. */
    private static void assertRejected(String expected, ThrowingCallable call) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class, call);
        assertThat(e).as(expected).isNotNull();
        assertThat(e.errors()).extracting(error -> error.field() + ":" + error.code()).containsExactly(expected);
    }

    private Entry expense(UUID id, long amount, UUID paidBy) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, cash.getId(), null, amount, null, "김밥천국",
                null, paidBy);
    }

    private void removeMember(User user) {
        memberRepository.delete(memberRepository.findByLedgerIdAndUserId(ledgerId, user.getId()).orElseThrow());
        memberRepository.flush();
    }
}
