package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 중복 경고(P-218, F-209, #59 응답 계약)의 규칙. 같은 장부에서 날짜, 금액, 가맹점이 모두 같은 지출·수입을 저장한 시각이 늦은
 * 것부터 5건까지 준다. 저장한 시각은 테스트가 SQL로 정한다. 정하지 않은 거래는 지금 시각이라 정한 거래보다 늦다.
 */
@IntegrationTest
class TransactionDuplicateQueryTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final long AMOUNT = 12_000;
    private static final Instant SAVED = Instant.parse("2020-01-01T00:00:00Z");
    private static final String DEVICE = "iphone.safari";

    @Autowired TransactionListQuery listQuery;
    @Autowired TransactionService transactionService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private User member;
    private UUID ledgerId;
    private UUID cash;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("duplicate@example.com");
        member = fixtures.user("duplicate-member@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
    }

    /** 종류(지출·수입)와 환불은 가리지 않는다. 금액은 응답의 {@code amount}(크기)로 비교한다. */
    @Test
    void 같은_날짜_금액_가맹점의_지출과_수입을_다른_구성원이_넣은_것까지_준다() {
        TransactionView expense = save(owner, TransactionType.EXPENSE, false, DAY, null, "올래국수", AMOUNT, 1);
        TransactionView income = save(member, TransactionType.INCOME, false, DAY, null, "올래국수", AMOUNT, 2);
        TransactionView refund = save(member, TransactionType.EXPENSE, true, DAY, null, "올래국수", AMOUNT, 3);
        save(owner, TransactionType.EXPENSE, false, DAY, null, "올래국수", AMOUNT + 1, 4);
        save(owner, TransactionType.EXPENSE, false, DAY, null, "올래국수점", AMOUNT, 5);

        List<TransactionView> found = duplicates("올래국수", null);

        assertThat(found).extracting(TransactionView::id).containsExactly(refund.id(), income.id(), expense.id());
        assertThat(found).extracting(TransactionView::createdBy)
                .containsExactly(member.getId(), member.getId(), owner.getId());
    }

    @Test
    void 날짜는_장부의_날짜로_그날_하루다() {
        TransactionView first = expenseAt(DAY, LocalTime.MIDNIGHT, 1);
        TransactionView last = expenseAt(DAY, LocalTime.of(23, 59), 2);
        expenseAt(DAY.minusDays(1), LocalTime.of(23, 59), 3);
        expenseAt(DAY.plusDays(1), LocalTime.MIDNIGHT, 4);

        assertThat(duplicates("올래국수", null)).extracting(TransactionView::id).containsExactly(last.id(), first.id());
    }

    @Test
    void 가맹점은_저장할_때처럼_맞춘_뒤_공백을_모두_빼고_대소문자를_무시해_비교한다() {
        expense("Star\u3000Bucks 강남", 1);
        String decomposed = Normalizer.normalize("강남", Normalizer.Form.NFD);

        for (String same : List.of("starbucks강남", " STAR BUCKS  강 남\u3000", "StarBucks" + decomposed)) {
            assertThat(duplicates(same, null)).as(same).hasSize(1);
        }
        for (String other : List.of("Star Bucks 강남점", "Star Bucks", "Star-Bucks 강남")) {
            assertThat(duplicates(other, null)).as(other).isEmpty();
        }
    }

    @Test
    void 가맹점이_없거나_비었거나_공백류뿐이면_결과가_없다() {
        expense(null, 1);

        for (String blank : Arrays.asList(null, "", " \u3000  ")) {
            assertThat(duplicates(blank, null)).as(String.valueOf(blank)).isEmpty();
        }
    }

    @Test
    void 삭제한_거래는_빼고_취소한_거래는_넣는다() {
        fixtures.delete(owner, expense("올래국수", 1));
        TransactionView canceled = fixtures.cancel(owner, expense("올래국수", 2));

        assertThat(duplicates("올래국수", null)).extracting(TransactionView::id).containsExactly(canceled.id());
    }

    @Test
    void 이체와_다른_장부의_거래는_보지_않는다() {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        // 이체에는 가맹점이 없다(F-203). 있다고 해도 보지 않음을 SQL로 넣어 본다.
        TransactionView transfer = fixtures.transfer(owner, ledgerId, cash, bank, DAY, AMOUNT);
        jdbc.update("update transaction set payee = '올래국수' where id = ?", transfer.id());
        User other = fixtures.user("duplicate-other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        UUID otherCash = fixtures.account(other, otherLedger, "현금", AccountType.CASH, 0, DAY).getId();
        transactionService.create(other.getId(), otherLedger,
                entry(TransactionType.EXPENSE, false, DAY, null, otherCash, "올래국수", AMOUNT), DEVICE);

        assertThat(duplicates("올래국수", null)).isEmpty();
    }

    /** DB의 uuid 순서는 바이트 순서라 Java의 {@code UUID.compareTo}(부호 있는 비교)와 다르다. 앞 글자로 순서를 정한다. */
    @Test
    void 저장한_시각이_늦은_것부터_5건이고_시각이_같으면_id가_큰_것이_먼저다() {
        List<UUID> saved = List.of(6, 2, 5, 1, 4, 3).stream().map(second -> expense("올래국수", second).id()).toList();
        assertThat(duplicates("올래국수", null)).extracting(TransactionView::id)
                .containsExactly(saved.get(0), saved.get(2), saved.get(4), saved.get(5), saved.get(1));

        String rest = UUID.randomUUID().toString().substring(8);
        UUID small = saveWithId(UUID.fromString("00000000" + rest), "같은시각");
        UUID big = saveWithId(UUID.fromString("ffffffff" + rest), "같은시각");
        assertThat(duplicates("같은시각", null)).extracting(TransactionView::id).containsExactly(big, small);
    }

    @Test
    void exclude로_준_거래는_결과에서_뺀다() {
        TransactionView editing = expense("올래국수", 1);
        TransactionView other = expense("올래국수", 2);

        assertThat(duplicates("올래국수", editing.id())).extracting(TransactionView::id).containsExactly(other.id());
        assertThat(duplicates("올래국수", UUID.randomUUID())).as("없는 거래").hasSize(2);
    }

    @Test
    void 조회만_하고_경고를_본_뒤에도_같은_거래를_저장할_수_있다() {
        expense("올래국수", 1);
        assertThat(duplicates("올래국수", null)).hasSize(1);

        transactionService.create(owner.getId(), ledgerId,
                entry(TransactionType.EXPENSE, false, DAY, null, cash, "올래국수", AMOUNT), DEVICE);
        assertThat(duplicates("올래국수", null)).hasSize(2);
    }

    @Test
    void 금액이_범위_밖이거나_가맹점이_길거나_쓸_수_없는_글자가_있으면_그_입력란의_오류다() {
        assertThat(rejection(0, "올래국수")).containsExactly("amount", FieldErrorCode.OUT_OF_RANGE);
        assertThat(rejection(10_000_000_000L, "올래국수")).containsExactly("amount", FieldErrorCode.OUT_OF_RANGE);
        assertThat(rejection(AMOUNT, "가".repeat(101))).containsExactly("payee", FieldErrorCode.TOO_LONG);
        for (String forbidden : List.of("올래\u200B국수", "올래\t국수", "올래\uD800국수")) {
            assertThat(rejection(AMOUNT, forbidden)).as(forbidden)
                    .containsExactly("payee", FieldErrorCode.INVALID_FORMAT);
        }
        String longest = " " + "가".repeat(100) + "\u3000";
        assertThat(listQuery.duplicates(owner.getId(), ledgerId, DAY, 9_999_999_999L, longest, null))
                .as("앞뒤 공백류를 지운 100자, 가장 큰 금액").isEmpty();
    }

    /** 서비스가 바꾼 것을 DB에 보낸 뒤 묻는다. 화면의 경고 요청은 저장과 다른 요청이다. */
    private List<TransactionView> duplicates(String payee, UUID exclude) {
        entityManager.flush();
        return listQuery.duplicates(owner.getId(), ledgerId, DAY, AMOUNT, payee, exclude);
    }

    private List<Object> rejection(long amount, String payee) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> listQuery.duplicates(owner.getId(), ledgerId, DAY, amount, payee, null));
        assertThat(e).as(payee).isNotNull();
        return List.of(e.field(), e.code());
    }

    private TransactionView expense(String payee, long savedSecond) {
        return save(owner, TransactionType.EXPENSE, false, DAY, null, payee, AMOUNT, savedSecond);
    }

    private TransactionView expenseAt(LocalDate on, LocalTime at, long savedSecond) {
        return save(owner, TransactionType.EXPENSE, false, on, at, "올래국수", AMOUNT, savedSecond);
    }

    private TransactionView save(User actor, TransactionType type, boolean refund, LocalDate on, LocalTime at,
                                 String payee, long amount, long savedSecond) {
        TransactionView tx = transactionService.create(actor.getId(), ledgerId,
                entry(type, refund, on, at, cash, payee, amount), DEVICE);
        savedAt(tx.id(), savedSecond);
        return tx;
    }

    private UUID saveWithId(UUID id, String payee) {
        UUID saved = transactionService.create(owner.getId(), ledgerId, new Entry(id, TransactionType.EXPENSE, DAY,
                null, cash, null, AMOUNT, false, payee, null, null), DEVICE).id();
        savedAt(saved, 1);
        return saved;
    }

    private void savedAt(UUID transactionId, long second) {
        entityManager.flush();
        jdbc.update("update transaction set created_at = ? where id = ?",
                Timestamp.from(SAVED.plusSeconds(second)), transactionId);
    }

    private static Entry entry(TransactionType type, boolean refund, LocalDate on, LocalTime at, UUID accountId,
                               String payee, long amount) {
        return new Entry(UUID.randomUUID(), type, on, at, accountId, null, amount, refund, payee, null, null);
    }
}
