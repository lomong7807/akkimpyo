package app.accountbook.category;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerOwnerException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

@IntegrationTest
class CategoryServiceTest {

    @Autowired CategoryService categoryService;
    @Autowired CategoryRepository categoryRepository;
    @Autowired AccountService accountService;
    @Autowired Fixtures fixtures;

    User owner;
    UUID ledgerId;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
    }

    private Category expense(String name, UUID parentId) {
        return categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand(name, CategoryKind.EXPENSE, parentId));
    }

    @Test
    void create_child_underTopLevelParent() {
        Category food = expense("식비", null);

        Category lunch = expense("점심", food.getId());

        assertThat(lunch.getParentId()).isEqualTo(food.getId());
        assertThat(lunch.getKind()).isEqualTo(CategoryKind.EXPENSE);
        assertThat(lunch.isSystem()).isFalse();
        assertThat(categoryService.list(owner.getId(), ledgerId)).extracting(Category::getName)
                .containsExactlyInAnyOrder("미분류", "미분류", "식비", "점심");
    }

    @Test
    void create_rejectsThirdLevel() {
        Category food = expense("식비", null);
        Category lunch = expense("점심", food.getId());

        assertThatThrownBy(() -> expense("김밥", lunch.getId()))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsParentOfOtherKind() {
        Category food = expense("식비", null);

        assertThatThrownBy(() -> categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("용돈", CategoryKind.INCOME, food.getId())))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsParentFromOtherLedger() {
        User other = fixtures.user("other@example.com");
        UUID otherLedgerId = fixtures.personalLedgerId(other);
        Category othersFood = categoryService.create(other.getId(), otherLedgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null));

        assertThatThrownBy(() -> expense("점심", othersFood.getId()))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_storesTrimmedNameOfTwentyCharacters() {
        String twenty = "가".repeat(19) + "😀";

        Category created = expense("  " + twenty + "  ", null);

        assertThat(categoryRepository.findById(created.getId()).orElseThrow().getName()).isEqualTo(twenty);
    }

    @Test
    void create_rejectsNameOfTwentyOneCharacters() {
        assertThatThrownBy(() -> expense("가".repeat(21), null))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsBlankName() {
        assertThatThrownBy(() -> expense("   ", null))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsSameNameAmongTopLevel() {
        expense("식비", null);

        assertThatThrownBy(() -> expense(" 식비 ", null))
                .isInstanceOf(DuplicateCategoryNameException.class)
                .hasMessage("같은 이름의 카테고리가 있습니다.");
    }

    @Test
    void create_rejectsSameNameUnderSameParent() {
        Category food = expense("식비", null);
        expense("점심", food.getId());

        assertThatThrownBy(() -> expense("점심", food.getId()))
                .isInstanceOf(DuplicateCategoryNameException.class);
    }

    @Test
    void create_allowsSameNameUnderOtherParentOrOtherKind() {
        Category food = expense("식비", null);
        Category leisure = expense("여가", null);
        expense("기타", food.getId());

        Category underOtherParent = expense("기타", leisure.getId());
        Category otherKind = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.INCOME, null));

        assertThat(categoryService.list(owner.getId(), ledgerId)).extracting(Category::getId)
                .contains(underOtherParent.getId(), otherKind.getId());
    }

    /** P-221에 "공백과 대소문자 무시"가 없으므로 앞뒤 공백만 지운 글자 그대로 비교한다. */
    @Test
    void create_treatsCaseAndInnerSpaceAsDifferentNames() {
        expense("Cafe", null);
        expense("식비", null);

        expense("cafe", null);
        expense("식 비", null);

        assertThat(categoryService.list(owner.getId(), ledgerId)).extracting(Category::getName)
                .contains("Cafe", "cafe", "식비", "식 비");
    }

    @Test
    void rename_rejectsNameOfSibling() {
        expense("식비", null);
        Category leisure = expense("여가", null);

        assertThatThrownBy(() -> categoryService.rename(owner.getId(), leisure.getId(), "식비"))
                .isInstanceOf(DuplicateCategoryNameException.class);
    }

    @Test
    void rename_rejectsNameOfTwentyOneCharacters() {
        Category food = expense("식비", null);

        assertThatThrownBy(() -> categoryService.rename(owner.getId(), food.getId(), "가".repeat(21)))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void rename_toOwnNameIsNotDuplicate() {
        Category food = expense("식비", null);

        Category renamed = categoryService.rename(owner.getId(), food.getId(), " 식비 ");

        assertThat(renamed.getName()).isEqualTo("식비");
    }

    @Test
    void delete_rejectsSystemCategory() {
        Category uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE);

        assertThatThrownBy(() -> categoryService.delete(owner.getId(), uncategorized.getId()))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(categoryRepository.findById(uncategorized.getId())).isPresent();
    }

    @Test
    void rename_rejectsSystemCategory() {
        Category uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.INCOME);

        assertThatThrownBy(() -> categoryService.rename(owner.getId(), uncategorized.getId(), "기타 수입"))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(categoryRepository.findById(uncategorized.getId()).orElseThrow().getName())
                .isEqualTo("미분류");
    }

    @Test
    void delete_rejectsCategoryWithLines() {
        Category food = expense("식비", null);
        Account cash = accountService.create(owner.getId(), ledgerId,
                new AccountCommand("현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)));
        fixtures.storedExpense(owner, ledgerId, cash.getId(), food.getId(), 12_000);

        assertThatThrownBy(() -> categoryService.delete(owner.getId(), food.getId()))
                .isInstanceOf(InUseException.class);
        assertThat(categoryRepository.findById(food.getId())).isPresent();
    }

    @Test
    void delete_rejectsCategoryWithChildren() {
        Category food = expense("식비", null);
        expense("점심", food.getId());

        assertThatThrownBy(() -> categoryService.delete(owner.getId(), food.getId()))
                .isInstanceOf(InUseException.class);
        assertThat(categoryRepository.findById(food.getId())).isPresent();
    }

    // --- 기본 카테고리 만들기 (P-223): 장부의 소유자만, 장부마다 한 번 ---

    @Test
    void createDefaults_rejectsNonOwner() {
        User outsider = fixtures.user("defaults-outsider@example.com");

        assertThatThrownBy(() -> categoryService.createDefaults(outsider.getId(), ledgerId))
                .isInstanceOf(NotLedgerOwnerException.class);
    }

    @Test
    void createDefaults_cannotRunTwiceOnSameLedger() {
        // 가입 때 이미 한 번 만들어졌다. 다시 부르면 미분류 유일 제약(uq_category_system)이나 이름 유일 제약에 걸린다.
        assertThatThrownBy(() -> categoryService.createDefaults(owner.getId(), ledgerId))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
