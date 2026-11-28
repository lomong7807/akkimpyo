package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.HistoryResponse.Change;
import app.accountbook.api.HistoryResponse.Item;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.ChangeAction;
import app.accountbook.transaction.TransactionHistoryQuery;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 카테고리 삭제로 같은 구분의 미분류로 옮긴 거래(#3)의 이력이 이력 응답(#47)에서 카테고리 칸의 전후 값으로 보인다. */
@IntegrationTest
class CategoryDeleteHistoryTest {

    @Autowired CategoryService categoryService;
    @Autowired TransactionHistoryQuery transactionHistoryQuery;
    @Autowired Fixtures fixtures;

    @Test
    void 옮긴_거래의_이력은_카테고리_이동이고_바뀐_칸은_카테고리뿐이다() {
        User user = fixtures.user("owner@example.com");
        UUID ledgerId = fixtures.personalLedgerId(user);
        LocalDate day = LocalDate.of(2026, 11, 18);
        UUID cash = fixtures.account(user, ledgerId, "현금", AccountType.CASH, 0, day).getId();
        UUID salary = categoryService.create(user.getId(), ledgerId,
                new CategoryCommand("급여", CategoryKind.INCOME, null)).getId();
        UUID trashed = fixtures.delete(user, fixtures.income(user, ledgerId, cash, salary, day, 3_000_000)).id();

        categoryService.delete(user.getId(), ledgerId, salary, null, "iphone.safari");

        List<Item> items = HistoryResponse.of(transactionHistoryQuery.history(user.getId(), ledgerId, trashed),
                Map.of()).items();
        assertThat(items).extracting(Item::action)
                .containsExactly(ChangeAction.CREATE, ChangeAction.DELETE, ChangeAction.CATEGORY_MOVE);
        assertThat(items.getLast().changes()).containsExactly(new Change("categoryId", salary.toString(),
                categoryService.uncategorized(ledgerId, CategoryKind.INCOME).getId().toString()));
    }
}
