package app.accountbook.support;

import java.util.UUID;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.jdbc.core.JdbcTemplate;

/** HTTP 테스트가 로그인한 사람으로 쓰는 사용자. 롤백되지 않으므로 한 번만 만들고 지우지 않는다. */
@TestComponent
public class SignedInUser {

    public static final UUID ID = UUID.fromString("0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60");

    SignedInUser(JdbcTemplate jdbc) {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, 'signed-in-user@example.com', 'none', '로그인한 사람', now())
                on conflict do nothing
                """, ID);
    }
}
