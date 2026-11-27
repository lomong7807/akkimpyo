package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionType;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * 거래 만들기 요청의 본문(#14 요청 계약). {@code type}으로 지출·수입과 이체의 모양이 갈린다.
 * 지출·수입: {@code id, type, occurredOn, occurredTime, accountId, categoryId, amount, payee, memo}.
 * 이체: {@code id, type, occurredOn, occurredTime, fromAccountId, toAccountId, amount, memo}.
 * 그 종류의 모양에 없는 입력란과 1A에서 보내지 않는 {@code refund}·{@code paidBy}는 읽지 않는다(환불은 아님, 결제한 사람은 작성자).
 *
 * <p>입력란을 하나씩 읽어 빠졌거나({@code REQUIRED}) 읽을 수 없는({@code INVALID_FORMAT}) 칸을 모두 알린다. 값을 다른 형으로
 * 바꿔 받지 않는다(ADR 002 2절). 범위, 글자 수, 같은 계좌 이체, 계좌·카테고리가 있는지는 서비스가 본다.
 * 이 검사는 서비스의 같은 id 조회보다 먼저다(ADR 006 결정 4의 형식 검증).
 */
record TransactionRequest(JsonNode id, JsonNode type, JsonNode occurredOn, JsonNode occurredTime,
                          JsonNode accountId, JsonNode categoryId, JsonNode amount, JsonNode payee, JsonNode memo,
                          JsonNode fromAccountId, JsonNode toAccountId) {

    /** 36자 표준 표기만 받고 대소문자는 가리지 않는다. 응답은 소문자다(architect 결정 2026-11-26, #102). */
    static final Pattern UUID_TEXT = Pattern.compile(
            "\\p{XDigit}{8}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{12}");
    /** 숫자는 ASCII만이다. {@link LocalDate#parse}는 부호 붙은 다섯 자리 연도도 받는다. */
    static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    /** 사용자가 고른 시각은 {@code HH:mm}만이다. 초와 배열은 받지 않는다(ADR 002 2절). */
    private static final Pattern TIME = Pattern.compile("[0-9]{2}:[0-9]{2}");

    /** 빠지거나 읽을 수 없는 칸이 하나라도 있으면 그것들을 모두 담아 거부한다. */
    TransactionCommand command() {
        List<InvalidRequestException> errors = new ArrayList<>();
        TransactionCommand command = command(uuid("id", id, true, errors), errors);
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return command;
    }

    /**
     * {@code id} 밖의 칸을 읽어 그 id의 명령을 만든다. 틀린 칸은 errors에 더하고, 그때의 명령은 쓰지 않는다.
     * 고치기 요청({@link TransactionUpdateRequest})이 경로의 id로 부른다.
     */
    TransactionCommand command(UUID txId, List<InvalidRequestException> errors) {
        TransactionType txType = type(errors);
        LocalDate date = date(errors);
        LocalTime time = time(errors);
        Long amountValue = amount(errors);
        return switch (txType) {
            case EXPENSE, INCOME -> new Entry(txId, txType, date, time, uuid("accountId", accountId, true, errors),
                    uuid("categoryId", categoryId, false, errors), orZero(amountValue), false,
                    text("payee", payee, errors), text("memo", memo, errors), null);
            case TRANSFER -> new Transfer(txId, date, time, uuid("fromAccountId", fromAccountId, true, errors),
                    uuid("toAccountId", toAccountId, true, errors), orZero(amountValue), text("memo", memo, errors));
            case null -> null;
        };
    }

    private TransactionType type(List<InvalidRequestException> errors) {
        String text = text("type", type, errors);
        if (text == null) {
            if (isAbsent(type)) {
                errors.add(required("type"));
            }
            return null;
        }
        return Arrays.stream(TransactionType.values())
                .filter(value -> value.name().equals(text))
                .findFirst()
                .orElseGet(() -> {
                    errors.add(unreadable("type"));
                    return null;
                });
    }

    /** 있는 날짜만 받는다(2026-02-30은 아니다). 범위는 서비스가 장부의 오늘로 본다. */
    private LocalDate date(List<InvalidRequestException> errors) {
        String text = text("occurredOn", occurredOn, errors);
        if (text == null) {
            if (isAbsent(occurredOn)) {
                errors.add(required("occurredOn"));
            }
            return null;
        }
        if (DATE.matcher(text).matches()) {
            try {
                return LocalDate.parse(text);
            } catch (DateTimeParseException e) {
                // 아래에서 형식 오류로 알린다.
            }
        }
        errors.add(unreadable("occurredOn"));
        return null;
    }

    /** 시각은 없어도 된다(시각 없음). 00:00과 다르다. */
    private LocalTime time(List<InvalidRequestException> errors) {
        String text = text("occurredTime", occurredTime, errors);
        if (text == null) {
            return null;
        }
        if (TIME.matcher(text).matches()) {
            try {
                return LocalTime.parse(text);
            } catch (DateTimeParseException e) {
                // 아래에서 형식 오류로 알린다.
            }
        }
        errors.add(unreadable("occurredTime"));
        return null;
    }

    /** JSON 정수만 받는다({@code 1.0}, {@code "5"}는 아니다). long에 담기지 않으면 범위 밖이다. */
    private Long amount(List<InvalidRequestException> errors) {
        if (isAbsent(amount)) {
            errors.add(required("amount"));
            return null;
        }
        if (!amount.isIntegralNumber()) {
            errors.add(unreadable("amount"));
            return null;
        }
        if (!amount.canConvertToLong()) {
            errors.add(new InvalidRequestException("amount", FieldErrorCode.OUT_OF_RANGE, "범위를 벗어난 금액입니다."));
            return null;
        }
        return amount.longValue();
    }

    private static UUID uuid(String field, JsonNode node, boolean required, List<InvalidRequestException> errors) {
        String text = text(field, node, errors);
        if (text == null) {
            if (required && isAbsent(node)) {
                errors.add(required(field));
            }
            return null;
        }
        if (UUID_TEXT.matcher(text).matches()) {
            return UUID.fromString(text);
        }
        errors.add(unreadable(field));
        return null;
    }

    private static String text(String field, JsonNode node, List<InvalidRequestException> errors) {
        if (isAbsent(node)) {
            return null;
        }
        if (node.isString()) {
            return node.stringValue();
        }
        errors.add(unreadable(field));
        return null;
    }

    /** 오류가 있으면 명령은 버려지므로 값은 상관없다. */
    private static long orZero(Long value) {
        return value == null ? 0 : value;
    }

    private static boolean isAbsent(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode();
    }

    private static InvalidRequestException required(String field) {
        return new InvalidRequestException(field, FieldErrorCode.REQUIRED, "값이 없습니다.");
    }

    private static InvalidRequestException unreadable(String field) {
        return new InvalidRequestException(field, FieldErrorCode.INVALID_FORMAT, "읽을 수 없는 값입니다.");
    }
}
