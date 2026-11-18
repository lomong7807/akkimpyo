package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.IntegrationTest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@IntegrationTest
class UserServiceTest {

    @Autowired UserService userService;
    @Autowired UserRepository userRepository;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired LedgerMemberRepository memberRepository;
    @Autowired CategoryRepository categoryRepository;

    @Test
    void createUser_createsPersonalLedgerWithOwnerAndDefaultCategories() {
        User user = userService.createUser("owner@example.com", "hash", "주인");

        List<LedgerMember> memberships = memberRepository.findByUserId(user.getId());
        assertThat(memberships).hasSize(1);
        LedgerMember membership = memberships.get(0);
        assertThat(membership.getRole()).isEqualTo(LedgerRole.OWNER);

        Ledger ledger = ledgerRepository.findById(membership.getLedgerId()).orElseThrow();
        assertThat(ledger.getName()).isEqualTo("내 가계부");
        assertThat(ledger.getTimezone()).isEqualTo("Asia/Seoul");

        List<Category> categories = categoryRepository.findByLedgerIdOrderByCreatedAtAsc(ledger.getId());
        assertThat(categories).hasSize(2).allSatisfy(category -> {
            assertThat(category.getName()).isEqualTo("미분류");
            assertThat(category.isSystem()).isTrue();
            assertThat(category.isTopLevel()).isTrue();
        });
        assertThat(categories).extracting(Category::getKind)
                .containsExactlyInAnyOrder(CategoryKind.INCOME, CategoryKind.EXPENSE);
    }

    @Test
    void createUser_rejectsDuplicateEmail() {
        userService.createUser("dup@example.com", "hash", "처음");

        assertThatThrownBy(() -> userService.createUser("dup@example.com", "hash2", "두번째"))
                .isInstanceOf(DuplicateEmailException.class);
        assertThat(userRepository.findAll()).extracting(User::getEmail).containsOnlyOnce("dup@example.com");
    }
}
