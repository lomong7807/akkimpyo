package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 같은 id의 만들기 요청에 대한 판정 표(ADR 006 결정 3).
 * 완전 삭제 기능은 아직 없어(#9) 완전 삭제 기록은 DB에 직접 넣는다.
 */
@IntegrationTest
class TransactionCreateSameIdTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    static final LocalTime NOON = LocalTime.of(12, 30);
    static final String DEVICE = "iphone.safari";
    static final String OTHER_DEVICE = "mac.chrome";

    @Autowired TransactionService transactionService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired AccountService accountService;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    User owner;
    User member;
    UUID ledgerId;
    UUID cash;
    UUID bank;
    UUID food;

    /** 표의 대상이 되는 요청. 카테고리와 결제한 사람을 비웠다. */
    final UUID id = UUID.randomUUID();
    Entry request;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        member = fixtures.user("member@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OPENING).getId();
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 0, OPENING).getId();
        food = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null)).getId();
        request = expense(id, cash, null, 12_000, null);
    }

    // ---------------------------------------------------------------- 1줄: 없다

    @Test
    void 없는_id는_새로_만들고_이력을_하나_남긴다() {
        CreateResult result = createAs(owner, request);

        assertThat(result.created()).isTrue();
        assertThat(result.transaction().version()).isEqualTo(1);
        assertThat(stored()).isEqualTo(result.transaction());
        assertThat(actions()).containsExactly(ChangeAction.CREATE);
    }

    // ---------------------------------------------------------------- 2줄: 내 것, version 1, 같은 내용

    @TestFactory
    Stream<DynamicTest> 내가_만든_version_1과_내용이_같으면_재전송이다() {
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        Entry withMillis = new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY,
                LocalTime.of(7, 5, 9, 123_456_789), cash, food, 5_000, true, null, null, null);
        Transfer transfer = new Transfer(UUID.randomUUID(), DAY, NOON, bank, cash, 30_000, "인출");
        createAs(owner, request);
        createAs(owner, withMillis);
        createAs(owner, transfer);

        return Stream.of(
                replayed("같은 요청", request),
                replayed("비운 카테고리를 미분류로 적은 요청", expense(id, cash, uncategorized, 12_000, null)),
                replayed("비운 결제한 사람을 나로 적은 요청", expense(id, cash, null, 12_000, owner.getId())),
                replayed("시각에 저장하지 않는 자릿수가 있는 환불", withMillis),
                replayed("이체", transfer));
    }

    private DynamicTest replayed(String label, TransactionCommand command) {
        return dynamicTest(label, () -> {
            TransactionView before = stored(idOf(command));
            long count = transactionRepository.count();

            CreateResult resent = transactionService.createOrReplay(owner.getId(), ledgerId, command, OTHER_DEVICE);

            assertThat(resent).isEqualTo(new CreateResult(before, false));
            assertThat(transactionRepository.count()).isEqualTo(count);
            assertThat(stored(idOf(command))).isEqualTo(before);
            assertThat(actions(idOf(command))).containsExactly(ChangeAction.CREATE);
        });
    }

    // ---------------------------------------------------------------- 3줄: 내 것, version 1, 다른 내용

    /** 비교하는 것은 요청이 정할 수 있는 값 전부다(유형, 날짜, 시각, 가맹점, 메모, 결제한 사람, 라인). */
    @TestFactory
    Stream<DynamicTest> 내가_만든_version_1과_내용이_다르면_저장된_거래를_담은_충돌이다() {
        createAs(owner, request);
        return Stream.of(
                conflicts("유형(수입)", entry(TransactionType.INCOME, DAY, NOON, cash, null, 12_000, false, "김밥천국", "점심",
                        null)),
                conflicts("유형(이체)", new Transfer(id, DAY, NOON, cash, bank, 12_000, "점심")),
                conflicts("날짜", entry(TransactionType.EXPENSE, DAY.plusDays(1), NOON, cash, null, 12_000, false,
                        "김밥천국", "점심", null)),
                conflicts("시각", entry(TransactionType.EXPENSE, DAY, NOON.plusMinutes(1), cash, null, 12_000, false,
                        "김밥천국", "점심", null)),
                conflicts("시각 없음", entry(TransactionType.EXPENSE, DAY, null, cash, null, 12_000, false, "김밥천국", "점심",
                        null)),
                conflicts("가맹점", entry(TransactionType.EXPENSE, DAY, NOON, cash, null, 12_000, false, "분식집", "점심",
                        null)),
                conflicts("메모", entry(TransactionType.EXPENSE, DAY, NOON, cash, null, 12_000, false, "김밥천국", null,
                        null)),
                conflicts("결제한 사람", expense(id, cash, null, 12_000, member.getId())),
                conflicts("계좌", expense(id, bank, null, 12_000, null)),
                conflicts("카테고리", expense(id, cash, food, 12_000, null)),
                conflicts("금액", expense(id, cash, null, 12_001, null)),
                conflicts("환불 여부", entry(TransactionType.EXPENSE, DAY, NOON, cash, null, 12_000, true, "김밥천국", "점심",
                        null)));
    }

    private DynamicTest conflicts(String label, TransactionCommand command) {
        return dynamicTest(label, () -> {
            TransactionView before = stored();

            IdConflictException conflict = conflictOf(owner, ledgerId, command);

            assertThat(conflict.current()).contains(before);
            assertThat(stored()).isEqualTo(before);
            assertThat(actions()).containsExactly(ChangeAction.CREATE);
        });
    }

    // ---------------------------------------------------------------- 4줄: 내 것, 이미 고쳐졌다

    @Test
    void 고친_뒤의_재전송은_내용을_비교하지_않고_지금_거래를_준다() {
        createAs(owner, request);
        TransactionView updated = transactionService.update(owner.getId(), id, 1,
                expense(id, bank, food, 15_000, null), DEVICE);

        assertThat(createAs(owner, request)).as("처음 보낸 내용").isEqualTo(new CreateResult(updated, false));
        assertThat(createAs(owner, expense(id, cash, null, 99_000, null))).as("어느 쪽과도 다른 내용")
                .isEqualTo(new CreateResult(updated, false));
        assertThat(createAs(owner, new Transfer(id, DAY, null, cash, bank, 1, null))).as("유형이 다른 내용")
                .isEqualTo(new CreateResult(updated, false));
        assertThat(stored()).isEqualTo(updated);
        assertThat(actions()).containsExactly(ChangeAction.CREATE, ChangeAction.UPDATE);
    }

    @Test
    void 다른_구성원이_고쳤어도_만든_사람의_재전송이다() {
        createAs(owner, request);
        TransactionView updated = transactionService.update(member.getId(), id, 1,
                expense(id, cash, null, 15_000, null), DEVICE);

        assertThat(createAs(owner, request)).isEqualTo(new CreateResult(updated, false));
    }

    @Test
    void 취소하거나_휴지통에_넣거나_되살린_거래도_재전송이다() {
        createAs(owner, request);

        TransactionView canceled = transactionService.cancel(owner.getId(), id, 1, DEVICE);
        assertThat(createAs(owner, request)).as("취소").isEqualTo(new CreateResult(canceled, false));
        TransactionView deleted = transactionService.delete(owner.getId(), id, 2, DEVICE);
        assertThat(createAs(owner, request)).as("휴지통").isEqualTo(new CreateResult(deleted, false));
        TransactionView restored = transactionService.restore(owner.getId(), id, 3, DEVICE);
        assertThat(createAs(owner, request)).as("복원").isEqualTo(new CreateResult(restored, false));

        assertThat(stored()).isEqualTo(restored);
        assertThat(actions()).containsExactly(ChangeAction.CREATE, ChangeAction.CANCEL, ChangeAction.DELETE,
                ChangeAction.RESTORE);
    }

    /** 결정 4의 이유: 고친 뒤 지운 카테고리와 계좌를 가리키는 재전송이 참조 검증에 걸리지 않는다. */
    @Test
    void 처음_쓴_계좌와_카테고리가_지워진_뒤에도_재전송이다() {
        Entry first = expense(id, cash, food, 12_000, null);
        createAs(owner, first);
        TransactionView updated = transactionService.update(owner.getId(), id, 1,
                expense(id, bank, null, 12_000, null), DEVICE);
        entityManager.flush();
        accountService.delete(owner.getId(), cash);
        categoryService.delete(owner.getId(), food);

        assertThat(createAs(owner, first)).isEqualTo(new CreateResult(updated, false));
    }

    // ---------------------------------------------------------------- 5줄: 그 밖

    /** 세 경우 가운데 다른 장부의 id와 다른 사람이 만든 id. 어느 경우든 예외의 종류, 메시지, 담긴 값이 같다. */
    @Test
    void 쓸_수_없는_id는_이유와_상관없이_같은_충돌이고_아무것도_담지_않는다() {
        User stranger = fixtures.user("stranger@example.com");
        UUID strangerLedger = fixtures.personalLedgerId(stranger);
        UUID strangerCash = fixtures.account(stranger, strangerLedger, "남의현금", AccountType.CASH, 0, OPENING).getId();
        UUID memberLedger = fixtures.personalLedgerId(member);
        UUID memberCash = fixtures.account(member, memberLedger, "내현금", AccountType.CASH, 0, OPENING).getId();
        TransactionView elsewhere = fixtures.expense(stranger, strangerLedger, strangerCash, null, DAY, 7_300);
        TransactionView elsewhereDeleted = fixtures.delete(stranger,
                fixtures.expense(stranger, strangerLedger, strangerCash, null, DAY, 7_300));
        TransactionView mineElsewhere = fixtures.expense(member, memberLedger, memberCash, null, DAY, 7_300);
        TransactionView others = fixtures.expense(owner, ledgerId, cash, null, DAY, 7_300);
        TransactionView othersEdited = fixtures.cancel(owner,
                fixtures.expense(owner, ledgerId, cash, null, DAY, 7_300));
        TransactionView othersDeleted = fixtures.delete(owner,
                fixtures.expense(owner, ledgerId, cash, null, DAY, 7_300));
        long count = transactionRepository.count();

        Map<String, TransactionView> unusable = Map.of(
                "다른 장부의 id", elsewhere,
                "다른 장부의 휴지통에 있는 id", elsewhereDeleted,
                "내가 만들었지만 다른 장부에 있는 id", mineElsewhere,
                "같은 장부에서 다른 사람이 만든 id", others,
                "같은 장부에서 다른 사람이 만들고 고쳐진 id", othersEdited,
                "같은 장부에서 다른 사람이 만들어 휴지통에 있는 id", othersDeleted);

        unusable.forEach((label, tx) -> {
            assertUnusable(label, tx.id());
            assertThat(transactionService.history(tx.createdBy(), tx.id())).as(label).hasSize((int) tx.version());
        });
        assertThat(transactionRepository.count()).isEqualTo(count);
    }

    /** 세 경우 가운데 완전히 지운 id(ADR 007 결정 7). 누가 어느 장부에서 어떻게 지웠든 위의 두 경우와 답이 같다. */
    @Test
    void 완전히_지운_거래의_id로는_다시_만들_수_없고_답이_다른_쓸_수_없는_id와_같다() {
        User stranger = fixtures.user("stranger@example.com");
        UUID strangerLedger = fixtures.personalLedgerId(stranger);
        Map<String, UUID> purged = Map.of(
                "내 장부에서 내가 지운 id", purged(ledgerId, ChangeAction.PURGE, member.getId()),
                "내 장부에서 다른 사람이 지운 id", purged(ledgerId, ChangeAction.PURGE, owner.getId()),
                "내 장부에서 탈퇴한 사람이 지운 id", purged(ledgerId, ChangeAction.PURGE, null),
                "내 장부에서 자동으로 지워진 id", purged(ledgerId, ChangeAction.AUTO_PURGE, null),
                "다른 장부에서 사람이 지운 id", purged(strangerLedger, ChangeAction.PURGE, stranger.getId()),
                "다른 장부에서 자동으로 지워진 id", purged(strangerLedger, ChangeAction.AUTO_PURGE, null));
        long count = transactionRepository.count();

        purged.forEach((label, txId) -> {
            assertUnusable(label, txId);
            assertThat(jdbc.queryForList("select version from change_log where transaction_id = ?", Long.class, txId))
                    .as(label).containsExactly(3L);
        });
        assertThat(transactionRepository.count()).isEqualTo(count);
    }

    // ---------------------------------------------------------------- 도우미

    private CreateResult createAs(User actor, TransactionCommand command) {
        CreateResult result = transactionService.createOrReplay(actor.getId(), ledgerId, command, DEVICE);
        flushAndClear();
        return result;
    }

    private IdConflictException conflictOf(User actor, UUID ledger, TransactionCommand command) {
        IdConflictException conflict = catchThrowableOfType(IdConflictException.class,
                () -> transactionService.createOrReplay(actor.getId(), ledger, command, DEVICE));
        assertThat(conflict).isNotNull();
        return conflict;
    }

    /** 같은 내용(다른 사람의 거래와 똑같은 요청)이든 다른 내용이든 답이 같다. */
    private void assertUnusable(String label, UUID txId) {
        List.of(7_300L, 9_900L).forEach(amount -> {
            IdConflictException conflict = conflictOf(member, ledgerId, new Entry(txId, TransactionType.EXPENSE, DAY,
                    null, cash, null, amount, false, null, null, owner.getId()));
            assertThat(conflict).as(label).isExactlyInstanceOf(IdConflictException.class)
                    .hasMessage("이 id는 쓸 수 없습니다.").hasNoCause();
            assertThat(conflict.current()).as(label).isEmpty();
        });
    }

    private UUID purged(UUID ledger, ChangeAction action, UUID actor) {
        UUID txId = UUID.randomUUID();
        fixtures.purgeRecord(txId, ledger, action, actor);
        return txId;
    }

    private TransactionView stored() {
        return stored(id);
    }

    private TransactionView stored(UUID txId) {
        flushAndClear();
        return transactionService.get(owner.getId(), txId);
    }

    private List<ChangeAction> actions() {
        return actions(id);
    }

    private List<ChangeAction> actions(UUID txId) {
        return transactionService.history(owner.getId(), txId).stream().map(ChangeLogView::action).toList();
    }

    /** 영속성 컨텍스트를 비워 다음 요청과 조회가 DB에 저장된 값을 읽게 한다. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private static UUID idOf(TransactionCommand command) {
        return switch (command) {
            case Entry entry -> entry.id();
            case Transfer transfer -> transfer.id();
        };
    }

    private Entry expense(UUID txId, UUID accountId, UUID categoryId, long amount, UUID paidBy) {
        return new Entry(txId, TransactionType.EXPENSE, DAY, NOON, accountId, categoryId, amount, false, "김밥천국",
                "점심", paidBy);
    }

    private Entry entry(TransactionType type, LocalDate on, LocalTime at, UUID accountId, UUID categoryId, long amount,
                        boolean refund, String payee, String memo, UUID paidBy) {
        return new Entry(id, type, on, at, accountId, categoryId, amount, refund, payee, memo, paidBy);
    }
}
