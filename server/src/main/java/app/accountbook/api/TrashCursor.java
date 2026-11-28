package app.accountbook.api;

import app.accountbook.transaction.TrashPage;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 휴지통의 cursor(#47). 거래 목록의 cursor({@link TransactionCursor}, #15)와 같은 꼴이다. 화면은 해석하지 않는 글자이고, 받은
 * 장부와 그 쪽 마지막 거래의 정렬 키를 담는다. 장부는 같은 목록에서 받은 cursor인지 보는 데만 쓰고, 무엇을 볼 수 있는지는 경로와
 * 구성원 확인이 정한다.
 *
 * <p>글자는 {@code 1|장부 id|T|지운 시각|거래 id}의 UTF-8을 패딩 없는 base64url로 쓴 것이다. 지운 시각은 UTC의 ISO 8601
 * ({@link Instant#toString()})이다. 읽을 때는 키를 꺼내 이 장부로 다시 써 보고 받은 글자와 같을 때만 받는다. 그래서 다른 장부의
 * cursor, 거래 목록의 cursor, 한 글자라도 바뀐 cursor는 모두 거절된다.
 */
final class TrashCursor {

    private static final String FORMAT = "1";
    private static final String TRASH = "T";
    private static final String SEPARATOR = "|";
    /** 만드는 cursor는 120자 안팎이다. 그보다 훨씬 긴 글자는 풀어 보지 않는다. */
    private static final int MAX_LENGTH = 256;
    /** 0~9999년, 소수는 밀리초나 마이크로초까지만. 저장되는 시각의 범위이고 더 큰 해는 DB의 범위를 넘을 수 있다. */
    private static final Pattern INSTANT =
            Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3}([0-9]{3})?)?Z");
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private TrashCursor() {
    }

    static String encode(UUID ledgerId, TrashPage.Key key) {
        String text = String.join(SEPARATOR, FORMAT, ledgerId.toString(), TRASH, key.deletedAt().toString(),
                key.id().toString());
        return ENCODER.encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    /** 이 장부의 휴지통에서 받은 cursor의 키. 망가졌거나 다른 장부·다른 목록의 것이면 비어 있다. */
    static Optional<TrashPage.Key> decode(String cursor, UUID ledgerId) {
        return key(cursor).filter(key -> encode(ledgerId, key).equals(cursor));
    }

    private static Optional<TrashPage.Key> key(String cursor) {
        if (cursor.length() > MAX_LENGTH) {
            return Optional.empty();
        }
        try {
            String[] parts = new String(DECODER.decode(cursor), StandardCharsets.UTF_8).split(Pattern.quote(SEPARATOR), -1);
            if (parts.length != 5 || !INSTANT.matcher(parts[3]).matches()) {
                return Optional.empty();
            }
            return Optional.of(new TrashPage.Key(Instant.parse(parts[3]), UUID.fromString(parts[4])));
        } catch (IllegalArgumentException | DateTimeException e) {
            return Optional.empty();
        }
    }
}
