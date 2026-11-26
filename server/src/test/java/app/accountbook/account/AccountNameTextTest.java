package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.common.DuplicateAccountNameException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.text.Normalizer;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 계좌 이름의 글자 규칙(P-220, P-214, #123): 조합형으로 맞춰 저장하고 비교하며, 거부 글자와 짝 없는 서로게이트를 막고,
 * 앞뒤 공백류를 지운다. 규칙 하나하나는 common.UserTextTest가 보고, 여기서는 만들기와 수정에 적용되는지 본다.
 */
@IntegrationTest
class AccountNameTextTest {

    static final LocalDate OPENING = LocalDate.of(2026, 11, 1);

    @Autowired AccountService accountService;
    @Autowired AccountRepository accountRepository;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
    }

    @Test
    void decomposedNameIsStoredComposed() {
        Account created = create(nfd("생활비"));

        assertThat(storedName(created)).isEqualTo("생활비").hasSize(3);
    }

    @Test
    void sameNameInDecomposedAndComposedFormIsDuplicate() {
        create("생활비");

        assertThatThrownBy(() -> create(nfd("생활비"))).isInstanceOf(DuplicateAccountNameException.class);
        assertThatThrownBy(() -> create(" 생활비　")).isInstanceOf(DuplicateAccountNameException.class);
    }

    @Test
    void lengthIsCountedInComposedForm() {
        String decomposedFifty = nfd("가각간갇갈".repeat(10));

        assertThat(storedName(create(decomposedFifty))).hasSize(50);
        assertRejected(() -> create(nfd("가".repeat(51))), FieldErrorCode.TOO_LONG);
    }

    @Test
    void updateStoresComposedNameAndSeesDuplicateInDecomposedForm() {
        Account first = create("생활비");
        Account second = create("비상금");

        Account renamed = accountService.update(owner.getId(), second.getId(),
                new AccountCommand(nfd("여행 자금"), AccountType.BANK, 0, OPENING));
        assertThat(storedName(renamed)).isEqualTo("여행 자금");

        assertThatThrownBy(() -> accountService.update(owner.getId(), second.getId(),
                new AccountCommand(nfd("생활비"), AccountType.BANK, 0, OPENING)))
                .isInstanceOf(DuplicateAccountNameException.class);
        assertThat(storedName(first)).isEqualTo("생활비");
    }

    @ParameterizedTest
    @ValueSource(strings = {"생활​비", "생활비‍", "생활비️", "생활비ㅤ", "ㅤ", "생활\t비",
            "생활\u0000비", "생활\u0085비", "생활 비", "생활‮비", "생활\uD800비", "생활비\uDC00"})
    void forbiddenCharactersAndUnpairedSurrogatesAreRejectedAndNothingIsStored(String name) {
        InvalidRequestException e = assertRejected(() -> create(name), FieldErrorCode.INVALID_FORMAT);

        assertThat(e.field()).isEqualTo("name");
        assertThat(accountService.list(owner.getId(), ledgerId)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {" ", "　", " 　  ", ""})
    void nameOfOnlySpacesIsRequired(String name) {
        assertRejected(() -> create(name), FieldErrorCode.REQUIRED);
        assertThat(accountService.list(owner.getId(), ledgerId)).isEmpty();
    }

    @Test
    void spacesAroundAreTrimmedAndEmojiIsKept() {
        String family = "👨‍👩‍👧";

        assertThat(storedName(create("　 가족 통장 " + family + " "))).isEqualTo("가족 통장 " + family);
        assertThat(storedName(create("1️⃣번 통장"))).isEqualTo("1️⃣번 통장");
    }

    private Account create(String name) {
        return accountService.create(owner.getId(), ledgerId, new AccountCommand(name, AccountType.BANK, 0, OPENING));
    }

    /** 영속성 컨텍스트를 거치지 않고 DB에 저장된 값을 읽는다. */
    private String storedName(Account account) {
        accountRepository.flush();
        return jdbc.queryForObject("select name from account where id = ?", String.class, account.getId());
    }

    private static InvalidRequestException assertRejected(Runnable call, FieldErrorCode code) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class, call::run);
        assertThat(e).isNotNull();
        assertThat(e.code()).isEqualTo(code);
        return e;
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }
}
