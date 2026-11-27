package app.accountbook.support;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.params.provider.Arguments;

/** 받으면 안 되는 access token들. 검증하는 쪽과 실제 필터 체인이 같은 목록을 쓴다. */
public final class BadAccessTokens {

    private BadAccessTokens() {
    }

    /** @param now 서버의 시계가 가리키는 시각. 있는 사용자는 {@link SignedInUser} 하나다 */
    public static Stream<Arguments> at(Instant now) {
        return Stream.of(expired(now), badSignatures(now), otherAlgorithms(now), badClaims(now), malformed(now))
                .flatMap(stream -> stream);
    }

    private static Stream<Arguments> expired(Instant now) {
        return Stream.of(
                argumentSet("만료된 토큰", TestAccessTokens.valid(SignedInUser.ID, now.minus(Duration.ofMinutes(16)))),
                argumentSet("방금 만료된 토큰", TestAccessTokens.valid(SignedInUser.ID, now.minus(Duration.ofMinutes(15)))),
                argumentSet("서버의 시계로는 만료, 실제 시각으로는 유효",
                        TestAccessTokens.valid(SignedInUser.ID, Instant.now())),
                argumentSet("만료가 없다", sign(claims(now).expirationTime(null))));
    }

    private static Stream<Arguments> badSignatures(Instant now) {
        String[] parts = TestAccessTokens.valid(SignedInUser.ID, now).split("\\.");
        String otherPayload = TestAccessTokens.valid(UUID.randomUUID(), now).split("\\.")[1];
        String otherHeader = base64("{\"alg\":\"HS256\",\"typ\":\"x\"}");
        return Stream.of(
                argumentSet("서명이 비었다", parts[0] + "." + parts[1] + "."),
                argumentSet("서명 부분이 없다", parts[0] + "." + parts[1]),
                argumentSet("서명을 고쳤다", parts[0] + "." + parts[1] + "." + flipFirst(parts[2])),
                argumentSet("서명을 잘랐다", parts[0] + "." + parts[1] + "." + parts[2].substring(0, 20)),
                argumentSet("본문을 바꿨다", parts[0] + "." + otherPayload + "." + parts[2]),
                argumentSet("헤더를 바꿨다", otherHeader + "." + parts[1] + "." + parts[2]),
                argumentSet("다른 키",
                        TestAccessTokens.sign(JWSAlgorithm.HS256, TestAccessTokens.randomKey(32), claims(now).build())),
                argumentSet("0으로 채운 키", TestAccessTokens.sign(JWSAlgorithm.HS256, new byte[32], claims(now).build())));
    }

    private static Stream<Arguments> otherAlgorithms(Instant now) {
        String[] parts = TestAccessTokens.valid(SignedInUser.ID, now).split("\\.");
        return Stream.of(
                argumentSet("alg=none", new PlainJWT(claims(now).build()).serialize()),
                argumentSet("alg=none에 서명을 붙였다", withHeader("{\"alg\":\"none\"}", parts)),
                argumentSet("alg=None", withHeader("{\"alg\":\"None\"}", parts)),
                argumentSet("alg가 없다", withHeader("{\"typ\":\"JWT\"}", parts)),
                argumentSet("서버 키의 HS384", TestAccessTokens.signWithServerKey(JWSAlgorithm.HS384, claims(now).build())),
                argumentSet("서버 키의 HS512", TestAccessTokens.signWithServerKey(JWSAlgorithm.HS512, claims(now).build())),
                argumentSet("RS256", TestAccessTokens.sign(JWSAlgorithm.RS256, rsa(), claims(now).build())),
                argumentSet("alg만 RS256", withHeader("{\"alg\":\"RS256\"}", parts)),
                argumentSet("암호화한 토큰", base64("{\"alg\":\"dir\",\"enc\":\"A256GCM\"}") + "..AAAA.AAAA.AAAA"),
                argumentSet("모르는 crit", withHeader("{\"alg\":\"HS256\",\"crit\":[\"x\"],\"x\":1}", parts)));
    }

    private static Stream<Arguments> badClaims(Instant now) {
        return Stream.of(
                argumentSet("iss가 없다", sign(claims(now).issuer(null))),
                argumentSet("iss가 다르다", sign(claims(now).issuer("other"))),
                argumentSet("iss의 대소문자가 다르다", sign(claims(now).issuer("Account-Book"))),
                argumentSet("iss가 주소다", sign(claims(now).issuer("https://account-book"))),
                argumentSet("iss가 글자가 아니다", sign(claims(now).claim("iss", 1))),
                argumentSet("aud가 없다", sign(claims(now).audience((String) null))),
                argumentSet("aud가 다르다", sign(claims(now).audience("account-book"))),
                argumentSet("aud가 비었다", sign(claims(now).audience(List.of()))),
                argumentSet("aud가 글자가 아니다", sign(claims(now).claim("aud", 1))),
                argumentSet("sub가 없다", sign(claims(now).subject(null))),
                argumentSet("sub가 비었다", sign(claims(now).subject(""))),
                argumentSet("sub가 UUID가 아니다", sign(claims(now).subject("user"))),
                argumentSet("sub가 이메일이다", sign(claims(now).subject("signed-in-user@example.com"))),
                argumentSet("sub가 대문자 UUID다", sign(claims(now).subject(SignedInUser.ID.toString().toUpperCase()))),
                argumentSet("sub가 줄인 UUID다", sign(claims(now).subject(SignedInUser.ID.toString().substring(1)))),
                argumentSet("sub에 공백이 있다", sign(claims(now).subject(" " + SignedInUser.ID))),
                argumentSet("sub가 글자가 아니다", sign(claims(now).claim("sub", 1))),
                argumentSet("없는 사용자", TestAccessTokens.valid(UUID.randomUUID(), now)),
                argumentSet("0으로 채운 사용자", TestAccessTokens.valid(new UUID(0, 0), now)));
    }

    private static Stream<Arguments> malformed(Instant now) {
        String valid = TestAccessTokens.valid(SignedInUser.ID, now);
        return Stream.of(
                argumentSet("글자 하나", "x"),
                argumentSet("점 하나", "."),
                argumentSet("점 둘", ".."),
                argumentSet("점 넷", "...."),
                argumentSet("JSON이 아니다", base64("x") + "." + base64("y") + "." + base64("z")),
                argumentSet("본문이 배열이다", TestAccessTokens.signRaw("[]")),
                argumentSet("본문이 JSON이 아니다", TestAccessTokens.signRaw("marker")),
                argumentSet("본문이 비었다", TestAccessTokens.signRaw("")),
                argumentSet("본문이 깊다", TestAccessTokens.signRaw("[".repeat(4500))),
                argumentSet("헤더가 깊다", base64("{\"a\":".repeat(1000)) + "." + valid.substring(valid.indexOf('.') + 1)),
                argumentSet("만료가 글자다", TestAccessTokens.signRaw("{\"exp\":\"marker\"}")),
                argumentSet("만료가 아주 크다", sign(claims(now).claim("exp", Double.MAX_VALUE))),
                argumentSet("아주 길다", "x".repeat(7000)),
                argumentSet("유효한 토큰 뒤에 길게 덧붙였다", valid + "A".repeat(6500)));
    }

    private static JWTClaimsSet.Builder claims(Instant now) {
        return TestAccessTokens.claims(SignedInUser.ID, now);
    }

    private static String sign(JWTClaimsSet.Builder claims) {
        return TestAccessTokens.sign(claims.build());
    }

    private static String withHeader(String header, String[] parts) {
        return base64(header) + "." + parts[1] + "." + parts[2];
    }

    private static RSASSASigner rsa() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return new RSASSASigner(generator.generateKeyPair().getPrivate());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String flipFirst(String text) {
        return (text.charAt(0) == 'A' ? 'B' : 'A') + text.substring(1);
    }

    private static String base64(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(UTF_8));
    }
}
