package app.accountbook.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * refresh token의 발급, 회전, 재사용 감지, 계열 폐기(ADR 001 결정 3, #26). 기한은 마지막 갱신부터 30일, 계열의 시작부터
 * 180일이고 그 시각부터 거부한다(P-106). 값은 32바이트 보안 난수이고 DB에는 SHA-256만 둔다. 값과 해시는 로그에 넣지 않는다.
 *
 * <p>토큰 행은 넣기만 한다. 지금 토큰, 바로 앞 토큰, 회전 시각, 폐기 시각은 계열 행에 있고, 갱신은 계열 행을
 * {@code FOR NO KEY UPDATE}로 잠근 뒤 그 행으로만 판단한다. 폐기는 계열 행의 UPDATE라 갱신과 서로 기다리므로 겹쳐도
 * 폐기 뒤에 쓸 수 있는 토큰이 남지 않는다(dba와 정함). 잠근 문장이 읽은 값으로만 판단하려고 JPA(먼저 읽은 엔터티를
 * 그대로 준다)를 거치지 않고 SQL을 쓴다. 메서드마다 한 트랜잭션이고 부른 쪽에 트랜잭션이 있으면 거기에 들어간다.
 */
@Component
final class RefreshTokenService {

    private static final Duration IDLE_LIFETIME = Duration.ofDays(30);
    private static final Duration ABSOLUTE_LIFETIME = Duration.ofDays(180);
    /** 32바이트를 패딩 없는 base64url로 적은 43자. 이 모양이 아니면 DB를 보지 않고 모르는 값으로 본다. */
    private static final Pattern VALUE_FORMAT = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final String FAMILY = "select * from refresh_token_family where id = :id";

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);

    private final JdbcClient jdbc;
    private final TransactionTemplate transactionTemplate;
    private final Clock clock;
    private final Duration reuseGrace;
    private final SecureRandom random = new SecureRandom();

    /** @param reuseGrace 회전 직후 바로 앞 토큰을 재사용으로 보지 않는 시간(security 결정 10초) */
    RefreshTokenService(JdbcClient jdbc, TransactionTemplate transactionTemplate, Clock clock,
                        @Value("${accountbook.refresh-token.reuse-grace:10s}") Duration reuseGrace) {
        if (reuseGrace.isNegative()) {
            throw new IllegalArgumentException("accountbook.refresh-token.reuse-grace는 0 이상이어야 합니다: " + reuseGrace);
        }
        this.jdbc = jdbc;
        this.transactionTemplate = transactionTemplate;
        this.clock = clock;
        this.reuseGrace = reuseGrace;
    }

    /** 로그인: 새 계열과 그 첫 토큰. 요청의 쿠키가 가리키던 계열은 부르는 쪽이 먼저 {@link #revokeFamily}로 폐기한다. */
    IssuedRefreshToken issue(UUID userId) {
        return transactionTemplate.execute(status -> {
            Instant now = now();
            Family family = new Family(UUID.randomUUID(), userId, now.plus(ABSOLUTE_LIFETIME), UUID.randomUUID(),
                    null, null, null);
            jdbc.sql("""
                    insert into refresh_token_family (id, user_id, created_at, absolute_expires_at, current_token_id)
                    values (:id, :userId, :now, :absoluteExpiresAt, :tokenId)
                    """)
                    .param("id", family.id()).param("userId", userId).param("now", at(now))
                    .param("absoluteExpiresAt", at(family.absoluteExpiresAt())).param("tokenId", family.currentTokenId())
                    .update();
            return insertToken(family.currentTokenId(), family, now);
        });
    }

    /**
     * 갱신: 받은 값 대신 쓸 새 값. 모르는 값, 만료, 폐기된 계열이면 빈 값이고 아무것도 바꾸지 않는다.
     * 지금 토큰이면 회전한다(받은 토큰이 바로 앞 토큰, 회전 시각은 지금). 바로 앞 토큰이고 그 회전부터 허용 시간 안이면
     * 같은 계열의 새 토큰을 재발급하고 그 전의 지금 토큰은 무효가 된다. 재발급은 회전으로 세지 않아 바로 앞 토큰과 회전
     * 시각이 그대로다. 그 밖의 이 계열 토큰이면 재사용으로 보고 계열을 폐기한다(폐기는 커밋하고 빈 값).
     * 같은 값으로 동시에 온 요청은 계열 잠금으로 차례로 돌아, 먼저 잠근 하나가 회전하고 나머지는 허용 시간 규칙을 따른다.
     * 재사용의 폐기가 되돌려지지 않게, 롤백될 수 있는 바깥 트랜잭션 안에서 부르지 않는다.
     */
    Optional<IssuedRefreshToken> rotate(String value) {
        return transactionTemplate.execute(status -> findToken(value).flatMap(token -> {
            Optional<Family> locked = jdbc.sql(FAMILY + " for no key update").param("id", token.familyId())
                    .query(RefreshTokenService::family).optional();
            if (locked.isEmpty()) {
                return Optional.empty(); // 토큰을 찾은 뒤 정리 작업(RefreshTokenCleanup)이 계열을 지웠다. 모르는 값과 같다.
            }
            Family family = locked.get();
            Instant now = now(); // 잠금을 기다린 뒤의 시각으로 판단한다.
            switch (judge(token, family, now)) {
                case CURRENT -> {
                    UUID tokenId = UUID.randomUUID();
                    jdbc.sql("""
                            update refresh_token_family
                               set current_token_id = :tokenId, previous_token_id = :rotated, rotated_at = :now
                             where id = :id
                            """)
                            .param("tokenId", tokenId).param("rotated", token.id()).param("now", at(now))
                            .param("id", family.id()).update();
                    return Optional.of(insertToken(tokenId, family, now));
                }
                case PREVIOUS -> {
                    UUID tokenId = UUID.randomUUID();
                    jdbc.sql("update refresh_token_family set current_token_id = :tokenId where id = :id")
                            .param("tokenId", tokenId).param("id", family.id()).update();
                    log.info("회전 직후 허용 시간 안의 재발급: 사용자 {}, 계열 {}", family.userId(), family.id());
                    return Optional.of(insertToken(tokenId, family, now));
                }
                case REUSED -> {
                    jdbc.sql("update refresh_token_family set revoked_at = :now where id = :id")
                            .param("now", at(now)).param("id", family.id()).update();
                    log.warn("refresh token 재사용 감지, 계열 폐기: 사용자 {}, 계열 {}", family.userId(), family.id());
                    return Optional.empty();
                }
                default -> {
                    return Optional.empty();
                }
            }
        }));
    }

    /**
     * 로그아웃, 로그인할 때 요청의 쿠키: 그 값의 계열을 폐기한다. 지금 토큰이든 이미 회전된 토큰이든, 누구의 계열이든 같다.
     * 모르는 값이거나 이미 폐기된 계열이면 아무것도 하지 않는다.
     */
    void revokeFamily(String value) {
        if (!wellFormed(value)) {
            return;
        }
        transactionTemplate.executeWithoutResult(status -> jdbc.sql("""
                        update refresh_token_family set revoked_at = :now
                         where id = (select family_id from refresh_token where token_hash = :hash) and revoked_at is null
                        """)
                .param("now", at(now())).param("hash", hash(value)).update());
    }

    /**
     * 비밀번호 바꾸기(P-108, #31): 이 사용자의 계열 중 keepValue의 계열(지금 기기)을 뺀 모두를 폐기한다. keepValue가 없거나,
     * 이 사용자의 것이 아니거나, 갱신이 받아 주지 않을 값(만료, 폐기, 재사용)이면 지금 기기의 계열도 폐기한다(ADR 001 결정 3).
     */
    void revokeOthers(UUID userId, String keepValue) {
        transactionTemplate.executeWithoutResult(status -> {
            Instant now = now();
            UUID keep = findToken(keepValue).filter(token -> {
                Family family = jdbc.sql(FAMILY).param("id", token.familyId()).query(RefreshTokenService::family).single();
                Use use = judge(token, family, now);
                return family.userId().equals(userId) && (use == Use.CURRENT || use == Use.PREVIOUS);
            }).map(Token::familyId).orElse(null);
            int revoked = jdbc.sql("""
                            update refresh_token_family set revoked_at = :now
                             where user_id = :userId and revoked_at is null and id is distinct from :keep
                            """)
                    .param("now", at(now)).param("userId", userId).param("keep", keep, Types.OTHER).update();
            log.info("다른 계열 폐기: 사용자 {}, {}개", userId, revoked);
        });
    }

    /** 받은 토큰이 이 계열에서 무엇인가. 계열이 폐기됐거나 절대 만료가 지났으면 어느 토큰이든 쓸 수 없다. */
    private Use judge(Token token, Family family, Instant now) {
        if (family.revokedAt() != null || !now.isBefore(family.absoluteExpiresAt())) {
            return Use.UNUSABLE;
        }
        boolean previousInGrace = token.id().equals(family.previousTokenId())
                && now.isBefore(family.rotatedAt().plus(reuseGrace));
        if (!token.id().equals(family.currentTokenId()) && !previousInGrace) {
            return Use.REUSED;
        }
        if (!now.isBefore(token.expiresAt())) {
            return Use.UNUSABLE;
        }
        return previousInGrace ? Use.PREVIOUS : Use.CURRENT;
    }

    /** 새 토큰 행. 기한은 지금부터 30일이고 계열의 절대 만료를 넘지 않는다. */
    private IssuedRefreshToken insertToken(UUID tokenId, Family family, Instant now) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant idle = now.plus(IDLE_LIFETIME);
        Instant expiresAt = idle.isBefore(family.absoluteExpiresAt()) ? idle : family.absoluteExpiresAt();
        jdbc.sql("""
                insert into refresh_token (id, family_id, token_hash, created_at, expires_at)
                values (:id, :familyId, :hash, :now, :expiresAt)
                """)
                .param("id", tokenId).param("familyId", family.id()).param("hash", hash(value))
                .param("now", at(now)).param("expiresAt", at(expiresAt)).update();
        return new IssuedRefreshToken(value, family.userId(), expiresAt);
    }

    private Optional<Token> findToken(String value) {
        if (!wellFormed(value)) {
            return Optional.empty();
        }
        return jdbc.sql("select id, family_id, expires_at from refresh_token where token_hash = :hash")
                .param("hash", hash(value))
                .query((rs, row) -> new Token(rs.getObject("id", UUID.class), rs.getObject("family_id", UUID.class),
                        instant(rs, "expires_at")))
                .optional();
    }

    private static Family family(ResultSet rs, int row) throws SQLException {
        return new Family(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                instant(rs, "absolute_expires_at"), rs.getObject("current_token_id", UUID.class),
                rs.getObject("previous_token_id", UUID.class), instant(rs, "rotated_at"), instant(rs, "revoked_at"));
    }

    private static boolean wellFormed(String value) {
        return value != null && VALUE_FORMAT.matcher(value).matches();
    }

    private static byte[] hash(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 쓸 수 없습니다.", e);
        }
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private enum Use { CURRENT, PREVIOUS, REUSED, UNUSABLE }

    private record Token(UUID id, UUID familyId, Instant expiresAt) {
    }

    private record Family(UUID id, UUID userId, Instant absoluteExpiresAt, UUID currentTokenId, UUID previousTokenId,
                          Instant rotatedAt, Instant revokedAt) {
    }
}
