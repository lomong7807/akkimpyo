package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.account.AccountType;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 가맹점별 최근 카테고리 제안(P-219, #61 응답 계약)의 규칙. 같은 장부의 지출 가운데 같은 가맹점으로 저장한 시각이 가장 늦은
 * 거래의 카테고리다. 삭제한 거래는 빼고 취소한 거래는 넣는다(ledger 결정 2026-11-24, #102). 저장한 시각은 테스트가 SQL로
 * 정한다. 정하지 않은 거래(다른 장부 등)는 지금 시각이라 정한 거래보다 늦다.
 */
@IntegrationTest
class CategorySuggestionQueryTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final Instant SAVED = Instant.parse("2020-01-01T00:00:00Z");
    private static final String DEVICE = "iphone.safari";

    @Autowired CategorySuggestionQuery suggestions;
    @Autowired TransactionService transactionService;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private UUID food;
    private UUID cafe;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("suggest@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        food = category(owner, ledgerId, "식비", CategoryKind.EXPENSE);
        cafe = category(owner, ledgerId, "카페", CategoryKind.EXPENSE);
    }

    @Test
    void 같은_가맹점의_지출_가운데_저장한_시각이_가장_늦은_거래의_카테고리다() {
        expense("올래국수", food, 2);
        TransactionView laterDay = save(TransactionType.EXPENSE, UUID.randomUUID(), DAY.plusDays(5), "올래국수", cafe, 1);

        assertThat(suggest("올래국수")).as("거래 날짜가 아니라 저장한 시각으로 고른다").contains(food);
        savedAt(laterDay.id(), 3);
        assertThat(suggest("올래국수")).contains(cafe);
    }

    /** DB의 uuid 순서는 바이트 순서라 Java의 {@code UUID.compareTo}(부호 있는 비교)와 다르다. 앞 글자로 순서를 정한다. */
    @Test
    void 저장한_시각이_같으면_id가_큰_거래다() {
        String rest = UUID.randomUUID().toString().substring(8);
        save(TransactionType.EXPENSE, UUID.fromString("ffffffff" + rest), DAY, "올래국수", cafe, 1);
        save(TransactionType.EXPENSE, UUID.fromString("00000000" + rest), DAY, "올래국수", food, 1);

        assertThat(suggest("올래국수")).contains(cafe);
    }

    @Test
    void 가맹점은_저장할_때처럼_맞춘_뒤_공백을_모두_빼고_대소문자를_무시해_비교한다() {
        expense("Star　Bucks 강남", cafe, 1);
        String decomposed = Normalizer.normalize("강남", Normalizer.Form.NFD);

        for (String same : List.of("starbucks강남", " STAR BUCKS  강 남　", "StarBucks" + decomposed)) {
            assertThat(suggest(same)).as(same).contains(cafe);
        }
        for (String other : List.of("Star Bucks 강남점", "Star Bucks", "Star-Bucks 강남")) {
            assertThat(suggest(other)).as(other).isEmpty();
        }
    }

    @Test
    void 수입과_이체는_보지_않는다() {
        UUID salary = category(owner, ledgerId, "급여", CategoryKind.INCOME);
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        expense("회사", food, 1);
        save(TransactionType.INCOME, UUID.randomUUID(), DAY, "회사", salary, 2);
        // 이체에는 가맹점이 없다(F-203). 있다고 해도 보지 않음을 SQL로 넣어 본다.
        TransactionView transfer = fixtures.transfer(owner, ledgerId, cash, bank, DAY, 1_000);
        jdbc.update("update transaction set payee = '회사' where id = ?", transfer.id());
        savedAt(transfer.id(), 3);
        save(TransactionType.INCOME, UUID.randomUUID(), DAY, "보너스", salary, 4);

        assertThat(suggest("회사")).contains(food);
        assertThat(suggest("보너스")).as("수입뿐인 가맹점").isEmpty();
    }

    @Test
    void 삭제한_거래는_빼고_취소한_거래는_넣는다() {
        expense("올래국수", food, 1);
        fixtures.delete(owner, expense("올래국수", cafe, 2));
        assertThat(suggest("올래국수")).contains(food);

        UUID snack = category(owner, ledgerId, "간식", CategoryKind.EXPENSE);
        fixtures.cancel(owner, expense("올래국수", snack, 3));
        assertThat(suggest("올래국수")).contains(snack);
    }

    @Test
    void 다른_장부의_같은_가맹점은_보지_않는다() {
        User other = fixtures.user("suggest-other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        UUID otherCash = fixtures.account(other, otherLedger, "현금", AccountType.CASH, 0, DAY).getId();
        UUID otherFood = category(other, otherLedger, "식비", CategoryKind.EXPENSE);
        transactionService.create(other.getId(), otherLedger, entry(TransactionType.EXPENSE, UUID.randomUUID(), DAY,
                otherCash, "올래국수", otherFood), DEVICE);

        assertThat(suggest("올래국수")).isEmpty();
        expense("올래국수", food, 1);
        assertThat(suggest("올래국수")).as("다른 장부의 더 늦은 거래").contains(food);
    }

    @Test
    void 거래가_지금_가리키는_카테고리를_준다() {
        TransactionView tx = expense("올래국수", food, 1);
        transactionService.update(owner.getId(), tx.id(), tx.version(),
                entry(TransactionType.EXPENSE, tx.id(), DAY, cash, "올래국수", cafe), DEVICE);
        assertThat(suggest("올래국수")).as("거래를 고쳐 바꾼 카테고리").contains(cafe);

        // 카테고리를 지우면 그 거래들을 고른 카테고리로 옮긴다(P-222, F-512). 기능이 아직 없어 그 결과를 SQL로 만든다.
        jdbc.update("update transaction_line set category_id = ? where category_id = ?", food, cafe);
        jdbc.update("delete from category where id = ?", cafe);
        assertThat(suggest("올래국수")).as("지운 카테고리가 아니라 옮긴 곳").contains(food);
    }

    @Test
    void 가맹점이_없거나_비었거나_공백류뿐이면_제안이_없다() {
        expense(null, food, 1);

        for (String blank : Arrays.asList(null, "", " 　  ")) {
            assertThat(suggest(blank)).as(String.valueOf(blank)).isEmpty();
        }
    }

    @Test
    void 가맹점이_100자를_넘거나_쓸_수_없는_글자가_있으면_payee의_오류다() {
        assertThat(suggest(" " + "가".repeat(100) + "　")).as("앞뒤 공백류를 지운 100자").isEmpty();
        assertThat(rejection("가".repeat(101))).containsExactly("payee", FieldErrorCode.TOO_LONG);
        for (String forbidden : List.of("올래​국수", "올래\t국수", "올래\uD800국수")) {
            assertThat(rejection(forbidden)).as(forbidden).containsExactly("payee", FieldErrorCode.INVALID_FORMAT);
        }
    }

    /** 서비스가 바꾼 것을 DB에 보낸 뒤 묻는다. 화면의 제안 요청은 저장과 다른 요청이다. */
    private Optional<UUID> suggest(String payee) {
        entityManager.flush();
        return suggestions.suggest(owner.getId(), ledgerId, payee);
    }

    private List<Object> rejection(String payee) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class, () -> suggest(payee));
        assertThat(e).as(payee).isNotNull();
        return List.of(e.field(), e.code());
    }

    private TransactionView expense(String payee, UUID categoryId, long savedSecond) {
        return save(TransactionType.EXPENSE, UUID.randomUUID(), DAY, payee, categoryId, savedSecond);
    }

    private TransactionView save(TransactionType type, UUID id, LocalDate on, String payee, UUID categoryId,
                                 long savedSecond) {
        TransactionView tx = transactionService.create(owner.getId(), ledgerId,
                entry(type, id, on, cash, payee, categoryId), DEVICE);
        savedAt(tx.id(), savedSecond);
        return tx;
    }

    private void savedAt(UUID transactionId, long second) {
        jdbc.update("update transaction set created_at = ? where id = ?",
                Timestamp.from(SAVED.plusSeconds(second)), transactionId);
    }

    private UUID category(User actor, UUID ledger, String name, CategoryKind kind) {
        return categoryService.create(actor.getId(), ledger, new CategoryCommand(name, kind, null)).getId();
    }

    private static Entry entry(TransactionType type, UUID id, LocalDate on, UUID accountId, String payee,
                               UUID categoryId) {
        return new Entry(id, type, on, null, accountId, categoryId, 1_000, false, payee, null, null);
    }
}
