package app.accountbook.auth;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** refresh token 테스트가 표를 직접 보고 치우는 도우미. 해시는 서비스와 따로 계산한다. */
final class RefreshTokenRows {

    private RefreshTokenRows() {
    }

    /** 장부 없이 사용자 행만 넣는다. */
    static UUID insertUser(JdbcTemplate jdbc) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, 'h', 'rt', now())",
                id, "rt-" + id + "@example.com");
        return id;
    }

    /** 토큰은 계열을, 계열은 사용자를 가리키므로 이 순서로 지운다. */
    static void deleteUser(JdbcTemplate jdbc, UUID userId) {
        jdbc.update("delete from refresh_token where family_id in (select id from refresh_token_family where user_id = ?)",
                userId);
        jdbc.update("delete from refresh_token_family where user_id = ?", userId);
        jdbc.update("delete from users where id = ?", userId);
    }

    static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static UUID tokenId(JdbcTemplate jdbc, String value) {
        return jdbc.queryForObject("select id from refresh_token where token_hash = ?", UUID.class, sha256(value));
    }

    /** 그 값이 속한 계열 행. 시각은 java.sql.Timestamp다. */
    static Map<String, Object> familyOf(JdbcTemplate jdbc, String value) {
        return jdbc.queryForMap("""
                select f.* from refresh_token_family f join refresh_token t on t.family_id = f.id where t.token_hash = ?
                """, sha256(value));
    }
}
