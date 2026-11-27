package app.accountbook.api;

import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * 계좌 추가·수정 요청의 본문(#13, #33). 입력란을 하나씩 읽어 여러 칸이 틀려도 모두 알린다. 형으로 바로 읽으면 첫 오류에서 멈춘다.
 * 값을 다른 형으로 바꿔 받지 않는다(ADR 002 2절): 시작 잔액은 JSON 정수, 기준일은 {@code YYYY-MM-DD} 글자,
 * 이름과 종류는 글자다. 글자 수, 범위, 같은 이름 같은 규칙은 서비스가 본다.
 */
record AccountRequest(JsonNode name, JsonNode type, JsonNode openingBalance, JsonNode openingDate) {

    /** 숫자는 ASCII만이다. {@link LocalDate#parse}는 부호 붙은 다섯 자리 연도도 받는다. */
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");

    /** 읽지 못한 입력란은 값 없음으로 넘기고 그 까닭을 따로 둔다. 빠졌거나 {@code null}인 것은 서비스가 {@code REQUIRED}로 본다. */
    Read read() {
        Map<String, FieldErrorCode> unreadable = new LinkedHashMap<>();
        String nameText = text("name", name, unreadable);
        AccountType accountType = accountType(text("type", type, unreadable), unreadable);
        Long balance = integer("openingBalance", openingBalance, unreadable);
        LocalDate date = date(text("openingDate", openingDate, unreadable), unreadable);
        return new Read(new AccountCommand(nameText, accountType, balance, date), unreadable);
    }

    private static String text(String field, JsonNode node, Map<String, FieldErrorCode> unreadable) {
        if (isAbsent(node)) {
            return null;
        }
        if (node.isString()) {
            return node.stringValue();
        }
        unreadable.put(field, FieldErrorCode.INVALID_FORMAT);
        return null;
    }

    private static AccountType accountType(String text, Map<String, FieldErrorCode> unreadable) {
        if (text == null) {
            return null;
        }
        return Arrays.stream(AccountType.values())
                .filter(value -> value.name().equals(text))
                .findFirst()
                .orElseGet(() -> {
                    unreadable.put("type", FieldErrorCode.INVALID_FORMAT);
                    return null;
                });
    }

    /** {@code 1.0}, {@code 1e2}처럼 값이 정수와 같아도 JSON 정수가 아니면 받지 않는다(PR #191과 같다). */
    private static Long integer(String field, JsonNode node, Map<String, FieldErrorCode> unreadable) {
        if (isAbsent(node)) {
            return null;
        }
        if (!node.isIntegralNumber()) {
            unreadable.put(field, FieldErrorCode.INVALID_FORMAT);
            return null;
        }
        if (!node.canConvertToLong()) {
            unreadable.put(field, FieldErrorCode.OUT_OF_RANGE);
            return null;
        }
        return node.longValue();
    }

    /** 있는 날짜만 받는다(2026-02-30은 아니다). 시각이 붙은 것과 배열은 받지 않는다(architect 결정 2026-11-26, #102). */
    private static LocalDate date(String text, Map<String, FieldErrorCode> unreadable) {
        if (text == null) {
            return null;
        }
        if (DATE.matcher(text).matches()) {
            try {
                return LocalDate.parse(text);
            } catch (DateTimeParseException e) {
                // 아래에서 형식 오류로 알린다.
            }
        }
        unreadable.put("openingDate", FieldErrorCode.INVALID_FORMAT);
        return null;
    }

    private static boolean isAbsent(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode();
    }

    /**
     * 숨기기·다시 보이기 요청의 본문(#43). {@code hidden}만 읽는다. JSON 참거짓만 받는다(글자 {@code "true"}와
     * 숫자는 아니다). 읽을 수 없는 값은 값 없음으로 넘겨, 경로의 계좌가 이 장부에 없으면 본문이 틀려도 404가 먼저 나가게 한다
     * (계좌 고치기와 같다).
     */
    record Visibility(JsonNode hidden) {

        Read read() {
            if (isAbsent(hidden)) {
                return new Read(null, false);
            }
            return hidden.isBoolean() ? new Read(hidden.booleanValue(), false) : new Read(null, true);
        }

        /** @param unreadable 참거짓이 아니었다. 서비스가 {@code REQUIRED}로 거부하면 {@code INVALID_FORMAT}으로 바꾼다 */
        record Read(Boolean hidden, boolean unreadable) {

            InvalidRequestException explain(InvalidRequestException rejected) {
                return unreadable && "hidden".equals(rejected.field()) && rejected.code() == FieldErrorCode.REQUIRED
                        ? new InvalidRequestException("hidden", FieldErrorCode.INVALID_FORMAT, "읽을 수 없는 값입니다.")
                        : rejected;
            }
        }
    }

    /**
     * @param command    서비스에 넘길 값. 읽지 못한 입력란은 {@code null}이라 서비스가 반드시 거부한다
     * @param unreadable 읽지 못한 입력란과 그 까닭
     */
    record Read(AccountCommand command, Map<String, FieldErrorCode> unreadable) {

        /** 서비스는 읽지 못한 입력란을 값 없음({@code REQUIRED})으로 본다. 그 입력란은 읽지 못한 까닭으로 바꾼다. */
        InvalidRequestException explain(InvalidRequestException rejected) {
            return InvalidRequestException.ofAll(rejected.errors().stream()
                    .map(error -> unreadable.containsKey(error.field())
                            ? new InvalidRequestException(error.field(), unreadable.get(error.field()),
                                    "읽을 수 없는 값입니다.")
                            : error)
                    .toList());
        }
    }
}
