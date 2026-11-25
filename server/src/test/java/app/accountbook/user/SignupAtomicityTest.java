package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.support.IntegrationTest;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 가입은 전체가 한 번에 되거나 아무것도 남지 않는다(F-002).
 * 테스트 트랜잭션으로 감싸면 가입의 롤백을 볼 수 없으므로 이 클래스는 트랜잭션 없이 돈다.
 * 실패한 가입은 아무것도 남기지 않으므로 따로 지울 데이터가 없다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class SignupAtomicityTest {

    private static final List<String> TABLES = List.of("users", "ledger", "ledger_member", "category");

    @Autowired UserService userService;
    @Autowired UserRepository userRepository;
    @Autowired JdbcTemplate jdbc;

    @Test
    void createUser_leavesNothingWhenDefaultCategoryInsertFailsMidway() {
        List<Long> before = rowCounts();
        // 지출의 열 번째 기본 카테고리("교육")를 넣는 순간 DB가 실패하게 한다.
        // 그 앞의 사용자, 장부, 구성원, 카테고리 아홉 개는 이미 같은 트랜잭션에서 INSERT된 뒤다.
        jdbc.execute("""
                CREATE FUNCTION fail_signup_category() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'test: default category insert fails midway';
                END $$
                """);
        try {
            jdbc.execute("""
                    CREATE TRIGGER fail_signup_category BEFORE INSERT ON category
                    FOR EACH ROW WHEN (NEW.name = '교육') EXECUTE FUNCTION fail_signup_category()
                    """);

            assertThatThrownBy(() -> userService.createUser("atomic@example.com", "hash", "주인"))
                    .hasStackTraceContaining("default category insert fails midway");
        } finally {
            jdbc.execute("DROP FUNCTION fail_signup_category() CASCADE");
        }

        assertThat(userRepository.existsByEmail("atomic@example.com")).isFalse();
        assertThat(rowCounts()).isEqualTo(before);
    }

    private List<Long> rowCounts() {
        return TABLES.stream()
                .map(table -> jdbc.queryForObject("select count(*) from " + table, Long.class))
                .toList();
    }
}
