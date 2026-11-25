package app.accountbook.category;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 동시 요청: 두 요청이 모두 "같은 이름 없음"을 본 뒤 저장하는 경우.
 * 앱 검사가 못 본 것으로 만들어, DB 유니크 위반(uq_category_name)이 같은 사용자 오류로 바뀌는지 본다.
 */
@IntegrationTest
class CategoryNameRaceTest {

    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @MockitoSpyBean CategoryRepository categoryRepository;

    User owner;
    UUID ledgerId;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        doReturn(false).when(categoryRepository).existsSibling(any(), any(), any(), any(), any());
    }

    @Test
    void create_translatesUniqueViolationToDuplicateName() {
        categoryService.create(owner.getId(), ledgerId, new CategoryCommand("식비", CategoryKind.EXPENSE, null));

        assertThatThrownBy(() -> categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null)))
                .isInstanceOf(DuplicateCategoryNameException.class);
    }

    @Test
    void rename_translatesUniqueViolationToDuplicateName() {
        categoryService.create(owner.getId(), ledgerId, new CategoryCommand("식비", CategoryKind.EXPENSE, null));
        Category leisure = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("여가", CategoryKind.EXPENSE, null));

        assertThatThrownBy(() -> categoryService.rename(owner.getId(), leisure.getId(), "식비"))
                .isInstanceOf(DuplicateCategoryNameException.class);
    }
}
