package app.accountbook.category;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.text.Normalizer;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 카테고리 이름의 글자 규칙(P-221, P-214, #123). 수용 기준의 예(분해형 저장과 중복, 20자, "식비"+보이지 않는 글자,
 * U+3164만, 가족·키캡 이모지, 공백류만)를 만들기와 이름 바꾸기에서 본다. 규칙 하나하나는 common.UserTextTest가 본다.
 */
@IntegrationTest
class CategoryNameTextTest {

    private static final String FAMILY = "👨‍👩‍👧";
    private static final String KEYCAP_ONE = "1️⃣";

    @Autowired CategoryService categoryService;
    @Autowired CategoryRepository categoryRepository;
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
        Category created = expense(nfd("간식"));

        assertThat(storedName(created)).isEqualTo("간식").hasSize(2);
    }

    @Test
    void sameNameInDecomposedAndComposedFormIsDuplicate() {
        // Fixtures.user는 기본 카테고리(P-223)를 지우므로 직접 만든다.
        expense("식비");
        assertThatThrownBy(() -> expense(nfd("식비"))).isInstanceOf(DuplicateCategoryNameException.class);

        Category snack = expense(nfd("간식"));
        assertThatThrownBy(() -> expense("간식")).isInstanceOf(DuplicateCategoryNameException.class);
        // 다른 상위 아래에서는 같은 이름이어도 된다(P-221). 분해형으로 넣어도 같다.
        assertThat(storedName(expense(nfd("간식"), snack.getId()))).isEqualTo("간식");
    }

    @Test
    void twentyDecomposedHangulCharactersAreStored() {
        String decomposedTwenty = nfd("가각간갇갈감갑갓강갖갗같갚갛개객갠갤갬갭");
        assertThat(decomposedTwenty.codePointCount(0, decomposedTwenty.length())).isGreaterThan(20);

        assertThat(storedName(expense(decomposedTwenty))).hasSize(20);
        assertRejected(() -> expense(nfd("가".repeat(21))), FieldErrorCode.TOO_LONG);
    }

    @ParameterizedTest
    @ValueSource(strings = {"식비‍", "식비️", "식비ㅤ", "ㅤ", "ㅤㅤ", "식​비",
            "식\u0000비", "식\uD800비"})
    void namesWithInvisibleOrUnstorableCharactersAreRejected(String name) {
        long before = categoryRepository.count();

        InvalidRequestException e = assertRejected(() -> expense(name), FieldErrorCode.INVALID_FORMAT);

        assertThat(e.field()).isEqualTo("name");
        assertThat(categoryRepository.count()).isEqualTo(before);
    }

    @Test
    void familyAndKeycapEmojiAreStored() {
        assertThat(storedName(expense("우리 " + FAMILY))).isEqualTo("우리 " + FAMILY);
        assertThat(storedName(expense(KEYCAP_ONE + " 고정비"))).isEqualTo(KEYCAP_ONE + " 고정비");
        assertThat(storedName(expense("😀"))).isEqualTo("😀");
    }

    @ParameterizedTest
    @ValueSource(strings = {" ", "　", "　   "})
    void nameOfOnlySpacesIsRequired(String name) {
        assertRejected(() -> expense(name), FieldErrorCode.REQUIRED);
    }

    @Test
    void everySpaceAroundIsTrimmed() {
        assertThat(storedName(expense("　  간식  "))).isEqualTo("간식");
    }

    @Test
    void renameAppliesTheSameRule() {
        Category snack = expense("간식");
        Category other = expense("외식");

        assertThat(storedName(categoryService.rename(owner.getId(), other.getId(), nfd("　야식 ")))).isEqualTo("야식");
        assertThatThrownBy(() -> categoryService.rename(owner.getId(), other.getId(), nfd("간식")))
                .isInstanceOf(DuplicateCategoryNameException.class);
        assertRejected(() -> categoryService.rename(owner.getId(), other.getId(), "야식‍"),
                FieldErrorCode.INVALID_FORMAT);
        assertRejected(() -> categoryService.rename(owner.getId(), other.getId(), "　"), FieldErrorCode.REQUIRED);
        assertThat(storedName(snack)).isEqualTo("간식");
        assertThat(storedName(other)).isEqualTo("야식");
    }

    private Category expense(String name) {
        return expense(name, null);
    }

    private Category expense(String name, UUID parentId) {
        return categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, CategoryKind.EXPENSE, parentId));
    }

    /** 영속성 컨텍스트를 거치지 않고 DB에 저장된 값을 읽는다. */
    private String storedName(Category category) {
        categoryRepository.flush();
        return jdbc.queryForObject("select name from category where id = ?", String.class, category.getId());
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
