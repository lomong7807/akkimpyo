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
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

@IntegrationTest
class UserServiceTest {

    @Autowired UserService userService;
    @Autowired UserRepository userRepository;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired LedgerMemberRepository memberRepository;
    @Autowired CategoryRepository categoryRepository;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;
    /** UserService가 주입받는 인코더. 통합 테스트에서는 가벼운 Argon2id다(TestPasswordEncoderConfig). */
    @Autowired PasswordEncoder passwordEncoder;
    /** 운영 빈. 테스트 인코더를 빼면 UserService가 받는 것이 이것 하나다. */
    @Autowired @Qualifier("passwordEncoder") PasswordEncoder productionPasswordEncoder;

    /** 규칙(P-101)에 맞는 비밀번호. 비밀번호가 주제가 아닌 테스트가 쓴다. */
    private static final String PASSWORD = "password1";

    @Test
    void createUser_createsPersonalLedgerWithOwnerAndDefaultCategories() {
        User user = userService.createUser("owner@example.com", PASSWORD, "주인");

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
        User user = userService.createUser("defaults@example.com", PASSWORD, "주인");
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
        User user = userService.createUser("order@example.com", PASSWORD, "주인");
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
        User user = userService.createUser("rule@example.com", PASSWORD, "주인");
        UUID ledgerId = memberRepository.findByUserId(user.getId()).get(0).getLedgerId();

        // 기본 카테고리는 CategoryService.create의 검증을 거치지 않고 들어간다. 같은 규칙(P-221)에 맞는지 본다.
        assertThat(categoryService.list(user.getId(), ledgerId)).allSatisfy(category ->
                assertThat(category.getName()).isEqualTo(Names.normalize(category.getName(), Category.NAME_MAX_LENGTH)));
    }

    @Test
    void createUser_defaultCategoriesBlockSameNameInSameKindOnly() {
        User user = userService.createUser("unique@example.com", PASSWORD, "주인");
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
        User first = userService.createUser("first-ledger@example.com", PASSWORD, "처음");
        User second = userService.createUser("second-ledger@example.com", PASSWORD, "두번째");
        UUID firstLedger = memberRepository.findByUserId(first.getId()).get(0).getLedgerId();
        UUID secondLedger = memberRepository.findByUserId(second.getId()).get(0).getLedgerId();

        assertThat(categoryService.list(first.getId(), firstLedger)).hasSize(17);
        assertThat(categoryService.list(second.getId(), secondLedger)).hasSize(17)
                .allSatisfy(category -> assertThat(category.getLedgerId()).isEqualTo(secondLedger));
    }

    @Test
    void createUser_rejectsDuplicateEmail() {
        userService.createUser("dup@example.com", PASSWORD, "처음");

        assertThatThrownBy(() -> userService.createUser("dup@example.com", "password2", "두번째"))
                .isInstanceOf(DuplicateEmailException.class);
        assertThat(userRepository.findAll()).extracting(User::getEmail).containsOnlyOnce("dup@example.com");
    }

    @Test
    void createUser_doesNotTranslateOtherUniqueViolationToDuplicateEmail() {
        // 유일 위반이라도 이메일 제약이 아니면 그대로 올린다. 제약은 테스트 트랜잭션과 함께 롤백된다.
        jdbc.execute("ALTER TABLE users ADD CONSTRAINT uq_test_users_display_name UNIQUE (display_name)");
        userService.createUser("other1@example.com", PASSWORD, "같은이름");

        assertThatThrownBy(() -> userService.createUser("other2@example.com", PASSWORD, "같은이름"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_test_users_display_name");
    }

    // --- 이메일 (P-101): 앞뒤 공백을 지우고 소문자로 저장하며 그 값으로 중복을 검사한다 ---

    @Test
    void createUser_storesEmailTrimmedAndLowercased() {
        User user = userService.createUser("  Owner@Example.COM ", PASSWORD, "주인");
        userRepository.flush();

        assertThat(user.getEmail()).isEqualTo("owner@example.com");
        assertThat(userRepository.existsByEmail("owner@example.com")).isTrue();
    }

    @Test
    void createUser_rejectsEmailDifferingOnlyByCaseAndSurroundingSpace() {
        userService.createUser("A@x.com", PASSWORD, "처음");

        assertThatThrownBy(() -> userService.createUser(" a@X.com ", "password2", "두번째"))
                .isInstanceOf(DuplicateEmailException.class);
        assertThat(userRepository.findAll()).extracting(User::getEmail).containsOnlyOnce("a@x.com");
    }

    @Test
    void createUser_lowercasesEmailRegardlessOfDefaultLocale() {
        Locale original = Locale.getDefault();
        // 터키어 로캘에서는 "I".toLowerCase()가 점 없는 ı(U+0131)가 된다.
        Locale.setDefault(Locale.forLanguageTag("tr-TR"));
        try {
            User user = userService.createUser("INFO@MAIL.COM", PASSWORD, "주인");

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

        assertThatThrownBy(() -> userService.createUser(email, PASSWORD, "주인"))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    @Test
    void createUser_storesEmailOfMaxLength() {
        String email = "a".repeat(254 - "@example.com".length()) + "@example.com";

        User user = userService.createUser("  " + email.toUpperCase(Locale.ROOT) + "  ", PASSWORD, "주인");
        userRepository.flush();

        assertThat(user.getEmail()).hasSize(254).isEqualTo(email);
    }

    @Test
    void createUser_rejectsEmailLongerThanMaxLengthWithoutEchoingIt() {
        String email = "a".repeat(255 - "@example.com".length()) + "@example.com";
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        assertThatThrownBy(() -> userService.createUser(email, PASSWORD, "주인"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("이메일은 254자 이하여야 합니다.");
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    // --- 이메일 글자 (P-101): 앞뒤 공백을 지운 값에 ASCII 인쇄 가능 문자(U+0021~U+007E)만 있어야 한다 ---

    @Test
    void createUser_storesEmailWithEveryPrintableAsciiCharacter() {
        // 앱이 통과시킨 값은 DB 제약(ck_users_email_normalized)도 지난다. 경계는 !(U+0021)와 ~(U+007E)다.
        String local = IntStream.rangeClosed(0x21, 0x7E)
                .filter(ch -> ch != '@')
                .mapToObj(Character::toString)
                .collect(Collectors.joining());

        User user = userService.createUser(local + "@example.com", PASSWORD, "주인");
        userRepository.flush();

        assertThat(jdbc.queryForObject("select email from users where id = ?", String.class, user.getId()))
                .isEqualTo(local.toLowerCase(Locale.ROOT) + "@example.com");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "0000", "0009", "000A", "000D", "001F",          // 제어 문자
            "0020", "007F",                                  // 범위 바로 밖(가운데 공백, DEL)
            "0080", "00A0",                                  // C1 제어 문자, 줄바꿈 없는 공백
            "200B", "200D", "202E", "FEFF",                  // 보이지 않는 글자
            "00E9", "0130", "0131", "AC00", "FF20", "1F600", // é, İ, ı, 가, 전각 @, 이모지
            "212A",                                          // 켈빈 기호. 소문자로 바꾸면 ASCII k가 된다
            "D800"})                                         // 짝 없는 서로게이트
    void createUser_rejectsEmailWithCharacterOutsidePrintableAsciiInTheMiddle(String codePoint) {
        assertEmailRejected("ow" + character(codePoint) + "ner@example.com");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "owner@예시.com",               // 도메인
            "owner\uFF20example.com",       // @ 자리에 전각 @
            "\u00A0owner@example.com",      // 앞에 붙은, strip()이 지우지 않는 글자
            "owner@example.com\u200B",      // 뒤에 붙은, strip()이 지우지 않는 글자
            "owner@example.com\r\nBcc:x"})  // 줄바꿈 뒤에 이어진 값
    void createUser_rejectsEmailWithCharacterOutsidePrintableAsciiAtAnyPosition(String email) {
        assertEmailRejected(email);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0009", "000A", "000D", "001F", "0020", "2003", "2028", "3000"})
    void createUser_stripsSurroundingUnicodeSpaceBeforeJudgingEmail(String codePoint) {
        String space = character(codePoint);

        User user = userService.createUser(space + "Owner@example.com" + space, PASSWORD, "주인");
        userRepository.flush();

        assertThat(user.getEmail()).isEqualTo("owner@example.com");
    }

    // --- 표시 이름 (P-101): 앞뒤 공백을 지운 1~20자, 다른 사람과 겹쳐도 된다 ---

    @Test
    void createUser_storesDisplayNameTrimmed() {
        User user = userService.createUser("trim@example.com", PASSWORD, "  아낌 표  ");
        userRepository.flush();

        assertThat(user.getDisplayName()).isEqualTo("아낌 표");
    }

    @Test
    void createUser_storesTwentyCharacterDisplayName() {
        User user = userService.createUser("twenty@example.com", PASSWORD, "가".repeat(20));
        userRepository.flush();

        assertThat(user.getDisplayName()).isEqualTo("가".repeat(20));
    }

    @Test
    void createUser_countsDisplayNameLengthInUnicodeCharacters() {
        // 😀는 UTF-16으로 2단위다. 글자 수로는 20자이므로 앱과 DB 제약 모두 받아야 한다.
        String twentyEmoji = "😀".repeat(20);

        User user = userService.createUser("emoji@example.com", PASSWORD, twentyEmoji);
        userRepository.flush();

        assertThat(user.getDisplayName()).isEqualTo(twentyEmoji);
        assertThatThrownBy(() -> userService.createUser("emoji21@example.com", PASSWORD, "😀".repeat(21)))
                .isInstanceOf(InvalidRequestException.class);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "   ", "\t\n", "가가가가가가가가가가가가가가가가가가가가가"})
    void createUser_rejectsDisplayNameOutsideOneToTwentyCharacters(String displayName) {
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        assertThatThrownBy(() -> userService.createUser("name@example.com", PASSWORD, displayName))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    @Test
    void createUser_allowsSameDisplayNameForDifferentUsers() {
        User first = userService.createUser("first@example.com", PASSWORD, "같은이름");
        User second = userService.createUser("second@example.com", PASSWORD, "같은이름");
        userRepository.flush();

        assertThat(first.getDisplayName()).isEqualTo(second.getDisplayName());
        assertThat(first.getId()).isNotEqualTo(second.getId());
    }

    // --- 비밀번호 (P-101): 8~72자(유니코드 글자 수), 영문과 숫자를 모두 포함. Argon2id 해시로만 저장한다 ---

    static Stream<String> acceptedPasswords() {
        return Stream.of(
                "abcd1234",                       // 8자
                "a1" + "x".repeat(70),            // 72자
                "가나다라마바사a1",                  // 한글이 섞여도 영문과 숫자가 하나씩 있으면 된다
                "!@#$%^&*()a1",                   // 기호
                "A1234567",                       // 대문자도 영문이다
                "a1" + "😀".repeat(70),           // 글자 수로 72자(UTF-16으로는 142단위)
                " abc1234",                       // 앞 공백도 글자다
                "abc1234 ");                      // 뒤 공백도 글자다
    }

    static Stream<String> rejectedPasswords() {
        return Stream.of(
                "",
                "abc1234",                        // 7자
                "a1" + "x".repeat(71),            // 73자
                "a1" + "😀".repeat(71),           // 글자 수로 73자
                "a1😀😀😀",                       // 글자 수로 5자(UTF-16으로는 8단위)
                "abcdefgh",                       // 영문만
                "12345678",                       // 숫자만
                "가나다라마바사1",                   // 한글과 숫자(영문 없음)
                "가나다라마바사a",                   // 한글과 영문(숫자 없음)
                "ａｂｃｄ１２３４",                  // 전각 영문과 숫자는 영문·숫자로 보지 않는다
                "        ");                      // 공백만
    }

    @ParameterizedTest
    @MethodSource("acceptedPasswords")
    void createUser_acceptsPasswordWithinRule(String password) {
        User user = userService.createUser("accepted@example.com", password, "주인");

        assertThat(passwordEncoder.matches(password, user.getPasswordHash())).isTrue();
    }

    @ParameterizedTest
    @NullSource
    @MethodSource("rejectedPasswords")
    void createUser_rejectsPasswordOutsideRuleWithoutEchoingIt(String password) {
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        assertThatThrownBy(() -> userService.createUser("rejected@example.com", password, "주인"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("비밀번호는 8~72자이고 영문과 숫자를 모두 포함해야 합니다.");
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    @Test
    void createUser_storesOnlyArgon2idHashOfPassword() {
        User user = userService.createUser("stored@example.com", "plain-Secret-42", "주인");
        userRepository.flush();

        String stored = jdbc.queryForObject("select password_hash from users where id = ?", String.class,
                user.getId());

        assertThat(stored).startsWith("$argon2id$").doesNotContain("plain-Secret-42");
        assertThat(passwordEncoder.matches("plain-Secret-42", stored)).isTrue();
        assertThat(passwordEncoder.matches("plain-Secret-43", stored)).isFalse();
    }

    @Test
    void createUser_hashesSamePasswordDifferentlyForEachUser() {
        User first = userService.createUser("salt1@example.com", PASSWORD, "처음");
        User second = userService.createUser("salt2@example.com", PASSWORD, "두번째");

        assertThat(first.getPasswordHash()).isNotEqualTo(second.getPasswordHash());
        assertThat(passwordEncoder.matches(PASSWORD, first.getPasswordHash())).isTrue();
        assertThat(passwordEncoder.matches(PASSWORD, second.getPasswordHash())).isTrue();
    }

    @Test
    void productionPasswordEncoderBeanIsArgon2idAtTheFloor() {
        // 운영 빈이 컨텍스트에 등록돼 있고(테스트 인코더가 가리지 않는다) ADR 001 결정 7의 하한 매개변수로 해시한다.
        String encoded = productionPasswordEncoder.encode(PASSWORD);

        assertThat(encoded).startsWith("$argon2id$v=19$m=19456,t=2,p=1$");
        assertThat(productionPasswordEncoder.matches(PASSWORD, encoded)).isTrue();
    }

    @Test
    void createUser_doesNotTrimPassword() {
        User user = userService.createUser("untrimmed@example.com", " abc1234 ", "주인");

        assertThat(passwordEncoder.matches(" abc1234 ", user.getPasswordHash())).isTrue();
        assertThat(passwordEncoder.matches("abc1234", user.getPasswordHash())).isFalse();
    }

    private void assertEmailRejected(String email) {
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();

        // 문구를 글자 그대로 고정한다. 입력값이 들어가면 실패한다.
        assertThatThrownBy(() -> userService.createUser(email, PASSWORD, "주인"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("이메일 형식이 올바르지 않습니다.");
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    private static String character(String codePoint) {
        return Character.toString(Integer.parseInt(codePoint, 16));
    }
}
