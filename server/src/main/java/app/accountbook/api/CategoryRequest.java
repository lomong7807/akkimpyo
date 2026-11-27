package app.accountbook.api;

import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * 카테고리 추가 요청의 본문(#44). 값을 다른 형으로 바꿔 받지 않는다(ADR 002 2절): 구분과 이름은 글자, 상위는 UUID 글자나
 * {@code null}이다. 읽을 수 없는 칸({@code INVALID_FORMAT})은 서비스 검증 전에 모두 모아 알린다(거래 만들기와 같다).
 * 빠진 칸, 글자 수, 상위가 맞는지, 같은 이름은 서비스가 본다.
 */
record CategoryRequest(JsonNode kind, JsonNode name, JsonNode parentId) {

    /** 36자 표준 표기만 받고 대소문자는 가리지 않는다({@link TransactionRequest}와 같다). */
    private static final Pattern UUID_TEXT = Pattern.compile(
            "\\p{XDigit}{8}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{4}-\\p{XDigit}{12}");

    /** 읽을 수 없는 칸이 하나라도 있으면 그것들을 모두 담아 거부한다. {@code parentId}가 없거나 {@code null}이면 최상위다. */
    CategoryCommand command() {
        List<InvalidRequestException> errors = new ArrayList<>();
        String kindText = text("kind", kind, errors);
        CategoryKind categoryKind = kindText == null ? null : Arrays.stream(CategoryKind.values())
                .filter(value -> value.name().equals(kindText))
                .findFirst()
                .orElseGet(() -> {
                    errors.add(unreadable("kind"));
                    return null;
                });
        String nameText = text("name", name, errors);
        String parentText = text("parentId", parentId, errors);
        UUID parent = null;
        if (parentText != null && UUID_TEXT.matcher(parentText).matches()) {
            parent = UUID.fromString(parentText);
        } else if (parentText != null) {
            errors.add(unreadable("parentId"));
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new CategoryCommand(nameText, categoryKind, parent);
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

    private static boolean isAbsent(JsonNode node) {
        return node == null || node.isNull() || node.isMissingNode();
    }

    private static InvalidRequestException unreadable(String field) {
        return new InvalidRequestException(field, FieldErrorCode.INVALID_FORMAT, "읽을 수 없는 값입니다.");
    }

    /**
     * 이름 바꾸기 요청의 본문. 이름만 읽고 다른 칸은 보지 않는다. 읽을 수 없는 이름은 값 없음으로 넘겨, 경로의 카테고리가 이 장부에
     * 없으면 본문이 틀려도 404가 먼저 나가게 한다(계좌 고치기와 같다).
     */
    record Rename(JsonNode name) {

        Read read() {
            if (isAbsent(name)) {
                return new Read(null, false);
            }
            return name.isString() ? new Read(name.stringValue(), false) : new Read(null, true);
        }

        /** @param unreadable 이름이 글자가 아니었다. 서비스가 {@code REQUIRED}로 거부하면 {@code INVALID_FORMAT}으로 바꾼다 */
        record Read(String name, boolean unreadable) {

            InvalidRequestException explain(InvalidRequestException rejected) {
                return unreadable && "name".equals(rejected.field()) && rejected.code() == FieldErrorCode.REQUIRED
                        ? CategoryRequest.unreadable("name") : rejected;
            }
        }
    }
}
