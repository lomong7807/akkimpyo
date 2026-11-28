package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 가맹점과 메모의 글자 규칙(P-214, #123)과 짝 없는 서로게이트(#164).
 * 검사와 값 맞추기는 형식 검증 단계라 같은 id 조회보다 먼저이고(ADR 006 결정 4), 재전송 비교는 요청과 저장된 값을 모두
 * 같은 맞추기에 통과시켜 본다(ADR 006 결정 3). 규칙 하나하나는 common.UserTextTest가 본다.
 */
@IntegrationTest
class TransactionTextTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    static final LocalTime NOON = LocalTime.of(12, 30);
    static final String DEVICE = "iphone.safari";

    @Autowired TransactionService transactionService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;
    UUID cash;
    UUID bank;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OPENING).getId();
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 0, OPENING).getId();
    }

    // ---------------------------------------------------------------- 저장 전의 값 맞추기

    @Test
    void payeeIsTrimmedAndComposedAndMemoLineEndingsAreConverted() {
        Entry request = expense(UUID.randomUUID(), "\u3000 " + nfd("김밥천국") + "\u00A0", nfd("점심") + "\r\n저녁\r");

        TransactionView created = transactionService.create(owner.getId(), ledgerId, request, DEVICE);

        assertThat(created.payee()).isEqualTo("김밥천국");
        assertThat(created.memo()).isEqualTo("점심\n저녁\n");
        assertThat(storedPayeeAndMemo(created.id())).containsExactly("김밥천국", "점심\n저녁\n");
    }

    @Test
    void memoIsNotTrimmed() {
        TransactionView created = transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), "김밥천국", "  점심 \u3000"), DEVICE);

        assertThat(storedPayeeAndMemo(created.id())).containsExactly("김밥천국", "  점심 \u3000");
    }

    @Test
    void emptyPayeeAndMemoAndBlankPayeeAreStoredAsNothing() {
        TransactionView empty = transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), "", ""), DEVICE);
        TransactionView blank = transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), "\u3000\u00A0 ", "   "), DEVICE);

        assertThat(storedPayeeAndMemo(empty.id())).containsExactly(null, null);
        assertThat(storedPayeeAndMemo(blank.id())).containsExactly(null, "   ");
    }

    @Test
    void lengthIsCountedAfterAligning() {
        TransactionView created = transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), nfd("가".repeat(100)), "\r\n".repeat(250) + nfd("나".repeat(250))), DEVICE);
        assertThat(storedPayeeAndMemo(created.id())[0]).hasSize(100);
        assertThat(storedPayeeAndMemo(created.id())[1]).hasSize(500);

        assertThat(rejection(() -> transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), "가".repeat(101), null), DEVICE)))
                .extracting(InvalidRequestException::field, InvalidRequestException::code)
                .containsExactly("payee", FieldErrorCode.TOO_LONG);
        assertThat(rejection(() -> transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), null, "가".repeat(501)), DEVICE)))
                .extracting(InvalidRequestException::field, InvalidRequestException::code)
                .containsExactly("memo", FieldErrorCode.TOO_LONG);
    }

    @Test
    void transferMemoAndUpdateFollowTheSameRule() {
        TransactionView transfer = transactionService.create(owner.getId(), ledgerId,
                new Transfer(UUID.randomUUID(), DAY, NOON, bank, cash, 30_000, nfd("인출") + "\r\n"), DEVICE);
        assertThat(storedPayeeAndMemo(transfer.id())).containsExactly(null, "인출\n");
        assertThat(rejection(() -> transactionService.create(owner.getId(), ledgerId,
                new Transfer(UUID.randomUUID(), DAY, NOON, bank, cash, 30_000, "인출\t"), DEVICE)))
                .extracting(InvalidRequestException::field, InvalidRequestException::code)
                .containsExactly("memo", FieldErrorCode.INVALID_FORMAT);

        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(id, "김밥천국", "점심"), DEVICE);
        TransactionView updated = transactionService.update(owner.getId(), id, 1,
                expense(id, " " + nfd("분식집") + "\u3000", "점심\r\n"), DEVICE);
        assertThat(storedPayeeAndMemo(updated.id())).containsExactly("분식집", "점심\n");
        assertThat(rejection(() -> transactionService.update(owner.getId(), id, 2,
                expense(id, "분식\u200B집", null), DEVICE)))
                .extracting(InvalidRequestException::field, InvalidRequestException::code)
                .containsExactly("payee", FieldErrorCode.INVALID_FORMAT);
    }

    // ---------------------------------------------------------------- 거부 글자와 짝 없는 서로게이트(#164)

    /** #164의 재현: 가맹점 {@code a\uD800b}는 {@code a?b}로 저장되지 않고 거부되며, 같은 요청을 다시 보내도 같은 400이다. */
    @Test
    void payeeWithUnpairedSurrogateIsRejectedAndSameRequestResentGetsTheSameRejection() {
        UUID id = UUID.randomUUID();
        Entry request = expense(id, "a\uD800b", "점심");

        InvalidRequestException first = rejection(() -> transactionService.create(owner.getId(), ledgerId, request,
                DEVICE));
        InvalidRequestException resent = rejection(() -> transactionService.createOrReplay(owner.getId(), ledgerId,
                request, DEVICE));

        assertThat(first.field()).isEqualTo("payee");
        assertThat(first.code()).isEqualTo(FieldErrorCode.INVALID_FORMAT);
        assertThat(resent).extracting(InvalidRequestException::field, InvalidRequestException::code,
                InvalidRequestException::getMessage)
                .containsExactly(first.field(), first.code(), first.getMessage());
        assertNothingStored(id);
    }

    @ParameterizedTest
    @ValueSource(strings = {"\uD800", "a\uDC00", "\uDE00\uD83D", "점심\uD83D"})
    void memoWithUnpairedSurrogateIsRejected(String memo) {
        UUID id = UUID.randomUUID();

        assertThat(rejection(() -> transactionService.create(owner.getId(), ledgerId, expense(id, null, memo), DEVICE)))
                .extracting(InvalidRequestException::field, InvalidRequestException::code)
                .containsExactly("memo", FieldErrorCode.INVALID_FORMAT);
        assertNothingStored(id);
    }

    @ParameterizedTest
    @ValueSource(strings = {"김밥\u200B천국", "김밥천국\u200D", "\u3164", "김밥\n천국", "김밥\u0000천국", "\u202E국천밥김"})
    void payeeWithForbiddenCharacterIsRejected(String payee) {
        UUID id = UUID.randomUUID();

        assertThat(rejection(() -> transactionService.create(owner.getId(), ledgerId, expense(id, payee, null),
                DEVICE)))
                .extracting(InvalidRequestException::field, InvalidRequestException::code)
                .containsExactly("payee", FieldErrorCode.INVALID_FORMAT);
        assertNothingStored(id);
    }

    @Test
    void pairedEmojiIsStoredAsItIs() {
        String family = "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67";
        TransactionView created = transactionService.create(owner.getId(), ledgerId,
                expense(UUID.randomUUID(), "\uD83C\uDF54 버거", family + "\n1\uFE0F\u20E3"), DEVICE);

        assertThat(storedPayeeAndMemo(created.id())).containsExactly("\uD83C\uDF54 버거", family + "\n1\uFE0F\u20E3");
    }

    /** 형식 검증이 같은 id 조회보다 먼저다(ADR 006 결정 4). 저장된 거래가 있어도 재전송이나 충돌이 아니라 형식 오류다. */
    @Test
    void forbiddenCharacterIsRejectedBeforeTheSameIdIsLookedUp() {
        UUID id = UUID.randomUUID();
        TransactionView stored = transactionService.create(owner.getId(), ledgerId, expense(id, "김밥천국", "점심"),
                DEVICE);
        flushAndClear();

        assertThat(rejection(() -> transactionService.createOrReplay(owner.getId(), ledgerId,
                expense(id, "김밥천국\uD800", "점심"), DEVICE)).field()).isEqualTo("payee");
        assertThat(rejection(() -> transactionService.createOrReplay(owner.getId(), ledgerId,
                expense(id, "김밥천국", "점심\u2028"), DEVICE)).field()).isEqualTo("memo");
        assertThat(transactionService.get(owner.getId(), id)).isEqualTo(stored);
    }

    // ---------------------------------------------------------------- 재전송 비교(ADR 006 결정 3)

    @Test
    void resendOfTheSameRawRequestIsReplayEvenThoughStoredValueWasAligned() {
        UUID id = UUID.randomUUID();
        Entry raw = expense(id, " " + nfd("김밥천국") + "\u3000", nfd("점심") + "\r\n");
        CreateResult first = transactionService.createOrReplay(owner.getId(), ledgerId, raw, DEVICE);
        flushAndClear();

        CreateResult resent = transactionService.createOrReplay(owner.getId(), ledgerId, raw, DEVICE);
        CreateResult aligned = transactionService.createOrReplay(owner.getId(), ledgerId,
                expense(id, "김밥천국", "점심\n"), DEVICE);

        assertThat(resent).isEqualTo(new CreateResult(first.transaction(), false));
        assertThat(aligned).isEqualTo(new CreateResult(first.transaction(), false));
    }

    @Test
    void emptyAndMissingPayeeAndMemoAreTheSameContent() {
        UUID id = UUID.randomUUID();
        CreateResult first = transactionService.createOrReplay(owner.getId(), ledgerId, expense(id, "", null),
                DEVICE);
        flushAndClear();

        assertThat(transactionService.createOrReplay(owner.getId(), ledgerId, expense(id, null, ""), DEVICE))
                .isEqualTo(new CreateResult(first.transaction(), false));
        assertThat(transactionService.createOrReplay(owner.getId(), ledgerId, expense(id, "\u3000", null), DEVICE))
                .isEqualTo(new CreateResult(first.transaction(), false));
    }

    /**
     * 이 규칙(#123) 전에 다듬지 않고 저장된 version 1 거래(앞뒤 공백, 분해형, \r\n, 빈 문자열)의 재전송은 저장된 값도
     * 같은 맞추기로 비교해 재전송이다.
     */
    @Test
    void resendOfTransactionStoredBeforeTheRuleComparesAlignedStoredValues() {
        UUID id = UUID.randomUUID();
        Entry request = expense(id, " " + nfd("김밥천국") + "\u00A0", nfd("점심") + "\r\n");
        transactionService.create(owner.getId(), ledgerId, expense(id, "김밥천국", "점심"), DEVICE);
        storeAsBeforeTheRule(id, " " + nfd("김밥천국") + "\u00A0", nfd("점심") + "\r\n");
        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.payee()).isNotEqualTo("김밥천국");

        assertThat(transactionService.createOrReplay(owner.getId(), ledgerId, request, DEVICE))
                .isEqualTo(new CreateResult(stored, false));
        assertThat(transactionService.createOrReplay(owner.getId(), ledgerId, expense(id, "김밥천국", "점심\n"),
                DEVICE)).isEqualTo(new CreateResult(stored, false));
        // 맞춘 뒤에도 다르면 그대로 충돌이다.
        assertThat(catchThrowableOfType(IdConflictException.class, () -> transactionService.createOrReplay(
                owner.getId(), ledgerId, expense(id, "분식집", "점심\n"), DEVICE)).current()).contains(stored);
    }

    @Test
    void resendOfTransactionStoredBeforeTheRuleWithEmptyStringsIsReplay() {
        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(id, "김밥천국", "점심"), DEVICE);
        storeAsBeforeTheRule(id, "", "");
        TransactionView stored = transactionService.get(owner.getId(), id);

        assertThat(transactionService.createOrReplay(owner.getId(), ledgerId, expense(id, null, null), DEVICE))
                .isEqualTo(new CreateResult(stored, false));
    }

    /**
     * 이 규칙 전에 거부 글자가 든 채 저장된 거래의 재전송은 형식 검증에서 400이다. 저장돼 있어도 "보낼 수 없음"으로
     * 보인다(architect가 받아들임, #123). 거부 글자를 뺀 요청은 저장된 값을 거부하지 않고 비교해 충돌이다.
     */
    @Test
    void resendOfTransactionStoredWithForbiddenCharacterIsRejectedAsFormatError() {
        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(id, "김밥천국", "점심"), DEVICE);
        // U+200B(Cf)는 앱 검사만 막는다. DB CHECK에 걸지 않는 글자라 지금도 DB에 바로 넣을 수 있다.
        flushAndClear();
        jdbc.update("update transaction set payee = ? where id = ?", "김밥\u200B천국", id);
        TransactionView stored = transactionService.get(owner.getId(), id);

        assertThat(rejection(() -> transactionService.createOrReplay(owner.getId(), ledgerId,
                expense(id, "김밥\u200B천국", "점심"), DEVICE)).field()).isEqualTo("payee");
        assertThat(catchThrowableOfType(IdConflictException.class, () -> transactionService.createOrReplay(
                owner.getId(), ledgerId, expense(id, "김밥천국", "점심"), DEVICE)).current()).contains(stored);
    }

    // ---------------------------------------------------------------- 도우미

    /**
     * 그 거래의 가맹점과 메모를 앱의 맞추기를 거치지 않은 이 규칙 전의 값으로 DB에서 바로 바꾼다. 지금은 V18의 CHECK가
     * 그런 값을 막으므로 이 테스트 트랜잭션 안에서만 CHECK를 내린다(테스트가 끝나면 함께 되돌아간다).
     */
    private void storeAsBeforeTheRule(UUID id, String payee, String memo) {
        flushAndClear();
        jdbc.execute("""
                alter table transaction
                    drop constraint ck_transaction_payee_nfc,
                    drop constraint ck_transaction_payee_trimmed,
                    drop constraint ck_transaction_memo_nfc,
                    drop constraint ck_transaction_memo_no_control
                """);
        jdbc.update("update transaction set payee = ?, memo = ? where id = ?", payee, memo, id);
    }

    private void assertNothingStored(UUID id) {
        flushAndClear();
        assertThat(transactionRepository.findById(id)).isEmpty();
        assertThat(jdbc.queryForObject("select count(*) from change_log where transaction_id = ?", Long.class, id))
                .isZero();
    }

    private String[] storedPayeeAndMemo(UUID id) {
        flushAndClear();
        return jdbc.queryForObject("select payee, memo from transaction where id = ?",
                (rs, rowNum) -> new String[] {rs.getString("payee"), rs.getString("memo")}, id);
    }

    private static InvalidRequestException rejection(ThrowingCallable call) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class, call);
        assertThat(e).isNotNull();
        return e;
    }

    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private Entry expense(UUID id, String payee, String memo) {
        return new Entry(id, TransactionType.EXPENSE, DAY, NOON, cash, null, 12_000, null, payee, memo, null);
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }
}
