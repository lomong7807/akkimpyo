package app.accountbook.category;

import java.util.UUID;

/** 카테고리 생성 요청. parentId가 null이면 최상위 분류다. */
public record CategoryCommand(String name, CategoryKind kind, UUID parentId) {
}
