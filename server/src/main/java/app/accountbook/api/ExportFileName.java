package app.accountbook.api;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.function.IntUnaryOperator;

/**
 * 내보낸 파일의 이름과 {@code Content-Disposition} 값(#57). 이름은 "장부 이름_시작일_종료일.확장자"이고 날짜는 {@code 20260101}
 * 꼴이다(F-701, K-01 화면설계서 5번). 장부 이름의 {@code / \ : * ? " < > |}와 제어 글자는 {@code _}로 바꾼다. 헤더에는
 * RFC 8187(RFC 5987의 후속)의 {@code filename*}(UTF-8)과, 그것을 못 읽는 클라이언트를 위해 출력할 수 있는 ASCII 밖의 글자를
 * {@code _}로 바꾼 {@code filename}을 함께 쓴다. 큰따옴표와 역슬래시는 이미 바뀌어 따옴표 안에 그대로 쓸 수 있다.
 */
final class ExportFileName {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("uuuuMMdd");
    /** 파일 이름에 쓸 수 없는 글자(Windows 기준). 제어 글자는 따로 본다. */
    private static final String RESERVED = "/\\:*?\"<>|";

    private ExportFileName() {
    }

    static String of(String ledgerName, LocalDate from, LocalDate to, String extension) {
        String name = replace(ledgerName, c -> RESERVED.indexOf(c) >= 0 || Character.isISOControl(c) ? '_' : c);
        return name + "_" + DAY.format(from) + "_" + DAY.format(to) + "." + extension;
    }

    /**
     * 내려받기 응답의 {@code Content-Disposition}(ASCII뿐). {@code filename*}은 URL 인코딩에서 공백만 {@code %20}으로 바꾼
     * 값이다. 인코딩하지 않는 {@code A-Z a-z 0-9 - . _ *} 가운데 RFC 8187이 받지 않는 {@code *}는 {@link #of}가 이미 바꿨다.
     */
    static String attachment(String fileName) {
        String ascii = replace(fileName, c -> c >= 0x20 && c <= 0x7E ? c : '_');
        return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''"
                + URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /** 코드포인트마다 바꾼다(이모지처럼 두 char인 글자도 하나로 본다). */
    private static String replace(String text, IntUnaryOperator mapping) {
        return text.codePoints().map(mapping)
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString();
    }
}
