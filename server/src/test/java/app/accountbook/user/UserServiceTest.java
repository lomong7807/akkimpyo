package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.category.CategoryService;
import app.accountbook.common.DuplicateCategoryNameException;
import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.IntegrationTest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

@IntegrationTest
class UserServiceTest {

    @Autowired UserService userService;
    @Autowired UserRepository userRepository;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired LedgerMemberRepository memberRepository;
    @Autowired CategoryRepository categoryRepository;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

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
        assertThat(categories).hasSize(17).allSatisfy(category -> assertThat(category.isTopLevel()).isTrue());
        assertThat(categories).filteredOn(Category::isSystem)
                .extracting(Category::getKind, Category::getName)
                .containsExactlyInAnyOrder(tuple(CategoryKind.EXPENSE, "미분류"), tuple(CategoryKind.INCOME, "미분류"));
    }

    // --- 기본 카테고리 (P-223): 지출 11개, 수입 4개, 미분류 2개가 명세에 적힌 이름과 순서로 생긴다 ---

    @Test
    void createUser_createsDefaultCategoriesWithSpecNamesInSpecOrder() {
        User user = userService.createUser("defaults@example.com", "hash", "주인");
        UUID ledgerId = memberRepository.findByUserId(user.getId()).get(0).getLedgerId();

        // 화면이 쓰는 목록(CategoryService.list)의 순서다. 미분류는 구분마다 맨 뒤에 온다(F-509).
        List<Category> categories = categoryService.list(user.getId(), ledgerId);

        assertThat(categories).filteredOn(category -> category.getKind() == CategoryKind.EXPENSE)
                .extracting(Category::getName)
                .containsExactly("식비", "카페·간식", "교통", "주거·통신", "생활용품", "의료·건강", "문화·여가", "쇼핑",
                        "경조사·선물", "교육", "기타", "미분류");
        assertThat(categories).filteredOn(category -> category.getKind() == CategoryKind.INCOME)
                .extracting(Category::getName)
                .containsExactly("급여", "부수입", "용돈", "기타", "미분류");
        assertThat(categories).filteredOn(category -> !category.isSystem()).hasSize(15);
    }

    @Test
    void createUser_givesDefaultCategoriesStrictlyIncreasingCreatedAtSoListOrderCannotTie() {
        User user = userService.createUser("order@example.com", "hash", "주인");
        UUID ledgerId = memberRepository.findByUserId(user.getId()).get(0).getLedgerId();
        categoryRepository.flush();

        List<Instant> createdAt = jdbc.queryForList(
                "select created_at from category where ledger_id = ? order by created_at", Timestamp.class, ledgerId)
                .stream().map(Timestamp::toInstant).toList();

        // 목록은 created_at으로만 정렬한다. DB에 저장된 값이 모두 달라야 순서가 흔들리지 않는다.
        assertThat(createdAt).hasSize(17).doesNotHaveDuplicates();
    }

    @Test
    void createUser_defaultCategoryNamesFollowCategoryNameRule() {
        User user = userService.createUser("rule@example.com", "hash", "주인");
        UUID ledgerId = memberRepository.findByUserId(user.getId()).get(0).getLedgerId();

        // 기본 카테고리는 CategoryService.create의 검증을 거치지 않고 들어간다. 같은 규칙(P-221)에 맞는지 본다.
        assertThat(categoryService.list(user.getId(), ledgerId)).allSatisfy(category ->
                assertThat(category.getName()).isEqualTo(Names.normalize(category.getName(), Category.NAME_MAX_LENGTH)));
    }

    @Test
    void createUser_defaultCategoriesBlockSameNameInSameKindOnly() {
        User user = userService.createUser("unique@example.com", "hash", "주인");
        UUID ledgerId = memberRepository.findByUserId(user.getId()).get(0).getLedgerId();

        // 지출의 "기타"와 수입의 "기타"는 구분이 달라 함께 있다. 같은 구분에 다시 만들면 거부된다.
        assertThat(categoryService.list(user.getId(), ledgerId)).filteredOn(category -> category.getName().equals("기타"))
                .extracting(Category::getKind)
                .containsExactlyInAnyOrder(CategoryKind.EXPENSE, CategoryKind.INCOME);
        assertThatThrownBy(() -> categoryService.create(user.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null)))
                .isInstanceOf(DuplicateCategoryNameException.class);
        assertThat(categoryService.create(user.getId(), ledgerId, new CategoryCommand("식비", CategoryKind.INCOME, null))
                .getName()).isEqualTo("식비");
    }

    @Test
    void createUser_givesEachUserTheirOwnDefaultCategories() {
        User first = userService.createUser("first-ledger@example.com", "hash", "처음");
        User second = userService.createUser("second-ledger@example.com", "hash", "두번째");
        UUID firstLedger = memberRepository.findByUserId(first.getId()).get(0).getLedgerId();
        UUID secondLedger = memberRepository.findByUserId(second.getId()).get(0).getLedgerId();

        assertThat(categoryService.list(first.getId(), firstLedger)).hasSize(17);
        assertThat(categoryService.list(second.getId(), secondLedger)).hasSize(17)
                .allSatisfy(category -> assertThat(category.getLedgerId()).isEqualTo(secondLedger));
    }

    @Test
    void createUser_rejectsDuplicateEmail() {
        userService.createUser("dup@example.com", "hash", "처음");

        assertThatThrownBy(() -> userService.createUser("dup@example.com", "hash2", "두번째"))
                .isInstanceOf(DuplicateEmailException.class);
        assertThat(userRepository.findAll()).extracting(User::getEmail).containsOnlyOnce("dup@example.com");
    }

    // --- 이메일 (P-101): 앞뒤 공백을 지우고 소문자로 저장하며 그 값으로 중복을 검사한다 ---

    @Test
    void createUser_storesEmailTrimmedAndLowercased() {
        User user = userService.createUser("  Owner@Example.COM ", "hash", "주인");
        userRepository.flush();

        assertThat(user.getEmail()).isEqualTo("owner@example.com");
        assertThat(userRepository.existsByEmail("owner@example.com")).isTrue();
    }

    @Test
    void createUser_rejectsEmailDifferingOnlyByCaseAndSurroundingSpace() {
        userService.createUser("A@x.com", "hash", "처음");

        assertThatThrownBy(() -> userService.createUser(" a@X.com ", "hash2", "두번째"))
                .isInstanceOf(DuplicateEmailException.class);
        assertThat(userRepository.findAll()).extracting(User::getEmail).containsOnlyOnce("a@x.com");
    }

    @Test
    void createUser_lowercasesEmailRegardlessOfDefaultLocale() {
        Locale original = Locale.getDefault();
        // 터키어 로캘에서는 "I".toLowerCase()가 점 없는 ı(U+0131)가 된다.
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));
        try {
            User user = userService.createUser("INFO@MAIL.COM", "hash", "주인");

            assertThat(user.getEmail()).isEqualTo("info@mail.com");
        } finally {
            Locale.setDefault(original);
        }
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "   ", "owner.example.com", "a@b@example.com", "a@@example.com",
            "@example.com", "owner@"})
    void createUser_rejectsEmailWithoutExactlyOneAtBetweenTwoParts(String email) {
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        assertThatThrownBy(() -> userService.createUser(email, "hash", "주인"))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    @Test
    void createUser_storesEmailOfMaxLength() {
        String email = "a".repeat(254 - "@example.com".length()) + "@example.com";

        User user = userService.createUser("  " + email.toUpperCase(Locale.ROOT) + "  ", "hash", "주인");
        userRepository.flush();

        assertThat(user.getEmail()).hasSize(254).isEqualTo(email);
    }

    @Test
    void createUser_countsEmailLengthInUnicodeCharactersLikeTheColumn() {
        // 😀는 UTF-16으로 2단위다. VARCHAR(255)는 글자 수로 세므로 글자 수 254자는 저장돼야 한다.
        String email = "😀".repeat(254 - "@example.com".length()) + "@example.com";

        User user = userService.createUser(email, "hash", "주인");
        userRepository.flush();

        assertThat(user.getEmail()).isEqualTo(email);
        assertThat(email.codePointCount(0, email.length())).isEqualTo(254);
    }

    @Test
    void createUser_rejectsEmailLongerThanMaxLengthWithoutEchoingIt() {
        String email = "a".repeat(255 - "@example.com".length()) + "@example.com";
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        assertThatThrownBy(() -> userService.createUser(email, "hash", "주인"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("이메일은 254자 이하여야 합니다.");
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    // --- 표시 이름 (P-101): 앞뒤 공백을 지운 1~20자, 다른 사람과 겹쳐도 된다 ---

    @Test
    void createUser_storesDisplayNameTrimmed() {
        User user = userService.createUser("trim@example.com", "hash", "  아낌 표  ");
        userRepository.flush();

        assertThat(user.getDisplayName()).isEqualTo("아낌 표");
    }

    @Test
    void createUser_storesTwentyCharacterDisplayName() {
        User user = userService.createUser("twenty@example.com", "hash", "가".repeat(20));
        userRepository.flush();

        assertThat(user.getDisplayName()).isEqualTo("가".repeat(20));
    }

    @Test
    void createUser_countsDisplayNameLengthInUnicodeCharacters() {
        // 😀는 UTF-16으로 2단위다. 글자 수로는 20자이므로 앱과 DB 제약 모두 받아야 한다.
        String twentyEmoji = "😀".repeat(20);

        User user = userService.createUser("emoji@example.com", "hash", twentyEmoji);
        userRepository.flush();

        assertThat(user.getDisplayName()).isEqualTo(twentyEmoji);
        assertThatThrownBy(() -> userService.createUser("emoji21@example.com", "hash", "😀".repeat(21)))
                .isInstanceOf(InvalidRequestException.class);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "   ", "\t\n", "가가가가가가가가가가가가가가가가가가가가가"})
    void createUser_rejectsDisplayNameOutsideOneToTwentyCharacters(String displayName) {
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        assertThatThrownBy(() -> userService.createUser("name@example.com", "hash", displayName))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    @Test
    void createUser_allowsSameDisplayNameForDifferentUsers() {
        User first = userService.createUser("first@example.com", "hash", "같은이름");
        User second = userService.createUser("second@example.com", "hash", "같은이름");
        userRepository.flush();

        assertThat(first.getDisplayName()).isEqualTo(second.getDisplayName());
        assertThat(first.getId()).isNotEqualTo(second.getId());
    }
}
