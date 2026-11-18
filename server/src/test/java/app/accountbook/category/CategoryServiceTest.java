package app.accountbook.category;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

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
}
