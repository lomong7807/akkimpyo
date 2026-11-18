package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import java.util.UUID;

/** 한 달 동안 카테고리 1개의 합계. 지출은 양수로 표시한다(환불은 지출을 줄인다). */
public record CategoryTotal(UUID categoryId, CategoryKind kind, long total) {

    /** 라인 amount의 합(지출은 음수)을 표시용 합계로 바꾼다. */
    public static CategoryTotal of(UUID categoryId, CategoryKind kind, long lineSum) {
        return new CategoryTotal(categoryId, kind, kind == CategoryKind.EXPENSE ? -lineSum : lineSum);
    }
}
