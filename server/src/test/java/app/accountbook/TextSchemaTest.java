package app.accountbook;

import static app.accountbook.support.CheckConstraints.CHANGE_BOTH;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.UserText;
import app.accountbook.support.CheckConstraints;
import app.accountbook.support.IntegrationTest;
import java.text.Normalizer;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 사용자가 넣는 글자의 DB 제약(V18, 이슈 #123): 조합형(*_nfc), 앞뒤 공백류(*_trimmed), 제어 문자(*_no_control).
 * 앱을 거치지 않고 DB에 바로 넣어 거부되는지 보고, 앱({@link UserText})이 통과시킨 값은 DB도 받는지 본다.
 * 서식 문자, 보이지 않는 글자, 이모지 자리의 예외는 DB에 걸지 않는다(앱 검사).
 */
@IntegrationTest
class TextSchemaTest {

    private static final String ZWJ = "‍";
    private static final String VS16 = "️";

    /** 앱이 받는 까다로운 입력. 각 칸의 앱 규칙을 지난 값이 DB 제약도 지나는지 본다. */
    private static final List<String> TRICKY_INPUTS = List.of(
            nfd("가각간갇갈감갑갓강갖갗같갚갛개객갠갤갬갭"),         // 분해형 한글 20자
            "👨" + ZWJ + "👩" + ZWJ + "👧", // 가족 이모지
            "1" + VS16 + "⃣", "#" + VS16 + "⃣",             // 키캡
            "❤" + VS16 + ZWJ + "🔥",                    // ❤️‍🔥
            "🇰🇷",                                // 🇰🇷
            "😀".repeat(20),
            "　식 비 ",                                  // 앞뒤 공백류, 가운데 U+00A0
            "식 비",                                              // NFC에서 U+2002가 되는 가운데 공백
            "é", "Å", "क़",                             // 합쳐지는 글자, 바뀌는 글자, 늘어나는 글자
            "¡ ÿ",                                      // C1 바로 위의 글자들
            "가́");

    @Autowired JdbcTemplate jdbc;

    UUID user;
    UUID ledger;

    @BeforeEach
    void setUp() {
        user = UUID.randomUUID();
        ledger = insertLedger();
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, 'hash', '스키마', now())
                """, user, user + "@example.com");
    }

    // ---------------------------------------------------------------- 조합형

    @Test
    void decomposedTextIsRejectedByDatabase() {
        String decomposed = nfd("식비");

        nameColumns().forEach(column ->
                assertRejectedBy(column.constraint("nfc"), () -> column.insert().accept(decomposed)));
        assertRejectedBy("ck_transaction_payee_nfc", () -> insertPayee(decomposed));
        assertRejectedBy("ck_transaction_memo_nfc", () -> insertMemo(decomposed));
    }

    @Test
    void composedTextIsAcceptedByDatabase() {
        nameColumns().forEach(column -> assertAccepted(() -> column.insert().accept("식비")));
        assertAccepted(() -> insertPayee("식비"));
        assertAccepted(() -> insertMemo("식비"));
    }

    // ---------------------------------------------------------------- 앞뒤 공백류

    @Test
    void textWithAnySpaceAroundIsRejectedByDatabase() {
        // PostgreSQL은 CHECK를 이름 순으로 본다. U+2000, U+2001은 NFC에서 바뀌는 글자라 *_nfc가 먼저 걸린다.
        List<String> nfcStable = UserText.TRIMMED_SPACES.chars().mapToObj(Character::toString)
                .filter(space -> Normalizer.isNormalized(space, Normalizer.Form.NFC)).toList();
        assertThat(nfcStable).hasSize(15).doesNotContain(" ", " ");

        nfcStable.forEach(space -> {
            nameColumns().forEach(column -> {
                assertRejectedBy(column.constraint("trimmed"), () -> column.insert().accept(space + "식비"));
                assertRejectedBy(column.constraint("trimmed"), () -> column.insert().accept("식비" + space));
            });
            assertRejectedBy("ck_transaction_payee_trimmed", () -> insertPayee(space + "김밥천국"));
            assertRejectedBy("ck_transaction_payee_trimmed", () -> insertPayee("김밥천국" + space));
        });
        List.of(" ", " ").forEach(space -> nameColumns().forEach(column ->
                assertRejectedBy(column.constraint("nfc"), () -> column.insert().accept("식비" + space))));
    }

    @Test
    void innerSpaceIsAcceptedByDatabase() {
        nameColumns().forEach(column -> assertAccepted(() -> column.insert().accept("식 비 　값")));
        assertAccepted(() -> insertPayee("김밥 천국"));
    }

    @Test
    void memoMayHaveSpacesAroundInDatabase() {
        assertAccepted(() -> insertMemo("  점심　"));
        assertAccepted(() -> insertMemo(" "));
    }

    @Test
    void emptyPayeeIsRejectedButMissingPayeeAndMemoAreAccepted() {
        assertRejectedBy("ck_transaction_payee_trimmed", () -> insertPayee(""));
        assertAccepted(() -> insertPayee(null));
        assertAccepted(() -> insertMemo(null));
    }

    // ---------------------------------------------------------------- 제어 문자

    @Test
    void textWithControlCharacterIsRejectedByDatabase() {
        List.of(0x0001, 0x0009, 0x000A, 0x000D, 0x001F, 0x007F, 0x0080, 0x0085, 0x009F).forEach(cp -> {
            String control = Character.toString(cp);
            nameColumns().forEach(column ->
                    assertRejectedBy(column.constraint("no_control"), () -> column.insert().accept("식" + control + "비")));
            assertRejectedBy("ck_transaction_payee_no_control", () -> insertPayee("김밥" + control + "천국"));
        });
    }

    @Test
    void memoAllowsOnlyLineFeedAmongControlCharactersInDatabase() {
        List.of(0x0001, 0x0009, 0x000B, 0x000C, 0x000D, 0x001F, 0x007F, 0x0080, 0x0085, 0x009F).forEach(cp ->
                assertRejectedBy("ck_transaction_memo_no_control",
                        () -> insertMemo("점심" + Character.toString(cp) + "저녁")));
        assertAccepted(() -> insertMemo("점심\n저녁\n"));
    }

    /** C1 범위(U+0080~U+009F)는 바이트가 아니라 코드포인트로 판정된다. U+00A0부터는 받는다(dba 요청). */
    @Test
    void controlRangeIsJudgedByCodePoint() {
        nameColumns().forEach(column -> {
            assertAccepted(() -> column.insert().accept("식 비"));
            assertAccepted(() -> column.insert().accept("식¡비"));
            // UTF-8로 C2 80~C2 9F가 아닌 글자 가운데 0x80~0x9F 바이트를 품은 글자(예: '가' = EA B0 80)는 받는다.
            assertAccepted(() -> column.insert().accept("가갸걀"));
        });
        assertAccepted(() -> insertMemo(" ¡가"));
    }

    /**
     * U+0000은 PostgreSQL text에 담을 수 없다. 앱이 거부하지 않으면 사용자 오류가 아니라 서버 오류가 된다(#123).
     * 드라이버가 보내기 전에 막는지 DB가 막는지는 보지 않는다. 어느 쪽이든 저장되지 않는다.
     */
    @Test
    void nulCannotBeStoredInText() {
        jdbc.execute("SAVEPOINT before_nul");
        assertThatThrownBy(() -> insertPayee("김밥\u0000천국")).isInstanceOf(DataAccessException.class);
        jdbc.execute("ROLLBACK TO SAVEPOINT before_nul");
        assertThat(jdbc.queryForObject("select count(*) from transaction where ledger_id = ?", Long.class, ledger))
                .isZero();
    }

    // ---------------------------------------------------------------- 앱이 통과시킨 값은 DB도 받는다

    @Test
    void namesPassedByAppAreAcceptedByDatabase() {
        TRICKY_INPUTS.forEach(raw -> {
            String name = UserText.name(raw, 20, "name");
            nameColumns().forEach(column -> assertAccepted(() -> column.insert().accept(name)));
        });
    }

    @Test
    void payeesAndMemosPassedByAppAreAcceptedByDatabase() {
        TRICKY_INPUTS.forEach(raw -> {
            assertAccepted(() -> insertPayee(UserText.payee(raw, 100)));
            assertAccepted(() -> insertMemo(UserText.memo(raw, 500)));
        });
        // 앱이 값 없음으로 바꾸는 입력과 메모만 받는 입력
        List.of("", "   ", "　 ").forEach(raw -> assertAccepted(() -> insertPayee(UserText.payee(raw, 100))));
        List.of("", "   ", "\n", "점심\r\n저녁\r", "\r").forEach(raw ->
                assertAccepted(() -> insertMemo(UserText.memo(raw, 500))));
    }

    // ---------------------------------------------------------------- 앱과 DB의 공백류 목록

    @Test
    void trimmedSpacesInDatabaseMatchApp() {
        List.of(new String[] {"account", "ck_account_name_trimmed"},
                new String[] {"category", "ck_category_name_trimmed"},
                new String[] {"users", "ck_users_display_name_trimmed"},
                new String[] {"transaction", "ck_transaction_payee_trimmed"}).forEach(check -> {
            String definition = CheckConstraints.of(jdbc).definition(check[0], check[1]);
            Matcher btrim = Pattern.compile("btrim\\([^,]+, '([^']*)'::text\\)").matcher(definition);

            assertThat(btrim.find()).as("%s에 btrim(col, '...')이 없다: %s", check[1], definition).isTrue();
            assertThat(btrim.group(1))
                    .as("UserText.TRIMMED_SPACES와 %s의 btrim 글자 목록이 다르다. %s", check[1], CHANGE_BOTH)
                    .isEqualTo(UserText.TRIMMED_SPACES);
            assertThat(btrim.find()).as("%s에 btrim이 둘 이상이다: %s", check[1], definition).isFalse();
        });
    }

    // ---------------------------------------------------------------- 도우미

    private record NameColumn(String prefix, Consumer<String> insert) {
        String constraint(String suffix) {
            return prefix + "_" + suffix;
        }
    }

    private List<NameColumn> nameColumns() {
        return List.of(
                new NameColumn("ck_account_name", this::insertAccountName),
                new NameColumn("ck_category_name", this::insertCategoryName),
                new NameColumn("ck_users_display_name", this::insertDisplayName));
    }

    /** 실패한 문장 뒤에는 트랜잭션이 막히므로 SAVEPOINT로 되돌려, 한 테스트에서 여러 문장을 볼 수 있게 한다. */
    private void assertRejectedBy(String constraint, ThrowingCallable statement) {
        jdbc.execute("SAVEPOINT before_rejected");
        assertThatThrownBy(statement).as(constraint)
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(constraint);
        jdbc.execute("ROLLBACK TO SAVEPOINT before_rejected");
    }

    private void assertAccepted(ThrowingCallable statement) {
        assertThatCode(statement).doesNotThrowAnyException();
    }

    private UUID insertLedger() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into ledger (id, name, created_at) values (?, '장부', now())", id);
        return id;
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 이름이 겹치지 않게 장부를 새로 만든다. */
    private void insertAccountName(String name) {
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_date, created_at)
                values (?, ?, ?, 'CASH', DATE '2026-11-01', now())
                """, UUID.randomUUID(), insertLedger(), name);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 이름이 겹치지 않게 장부를 새로 만든다. */
    private void insertCategoryName(String name) {
        jdbc.update("""
                insert into category (id, ledger_id, kind, name, system, created_at)
                values (?, ?, 'EXPENSE', ?, false, now())
                """, UUID.randomUUID(), insertLedger(), name);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertDisplayName(String displayName) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, 'hash', ?, now())
                """, id, id + "@example.com", displayName);
    }

    private void insertPayee(String payee) {
        insertTransaction(payee, null);
    }

    private void insertMemo(String memo) {
        insertTransaction(null, memo);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 라인은 없다. */
    private void insertTransaction(String payee, String memo) {
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, payee, memo, status, created_by, version,
                                         created_at, updated_at)
                values (?, ?, 'EXPENSE', DATE '2026-11-18', ?, ?, 'POSTED', ?, 1, now(), now())
                """, UUID.randomUUID(), ledger, payee, memo, user);
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }
}
