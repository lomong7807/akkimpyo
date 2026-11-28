package app.accountbook.api;

import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** 가맹점별 최근 카테고리 제안(#61 응답 계약). 제안이 없으면 {@code categoryId}가 null이고 화면이 미분류로 둔다. */
record CategorySuggestionResponse(@Nullable UUID categoryId) {
}
