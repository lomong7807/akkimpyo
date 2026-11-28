package app.accountbook.api;

import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 최상위 카테고리 하나와 그 하위(#34 응답 계약). 미분류는 {@code system}이 true다. 이름은 "미분류" 그대로지만
 * 화면은 이름으로 판단하지 않는다. 하위가 없으면 {@code children}은 빈 배열이다.
 */
record CategoryResponse(UUID id, CategoryKind kind, String name, boolean system, List<Child> children) {

    /** 지출 먼저, 다음 수입(#34). {@link CategoryKind}의 선언 순서와 다르다. */
    private static final List<CategoryKind> KIND_ORDER = List.of(CategoryKind.EXPENSE, CategoryKind.INCOME);

    /** 하위 분류. 카테고리는 2단계까지라 하위는 하위를 갖지 않는다. */
    @Schema(name = "CategoryChild")
    record Child(UUID id, String name) {
    }

    /**
     * 만들었거나 이름을 바꾼 카테고리 하나(#44). 하위 카테고리도 목록의 최상위 항목과 같은 모양이고 {@code children}이 비어 있다.
     * {@code categories}는 {@code CategoryService.list}의 결과이고 그 가운데 이 카테고리의 하위를 받은 순서대로 담는다.
     */
    static CategoryResponse of(Category category, List<Category> categories) {
        return new CategoryResponse(category.getId(), category.getKind(), category.getName(), category.isSystem(),
                categories.stream()
                        .filter(child -> category.getId().equals(child.getParentId()))
                        .map(child -> new Child(child.getId(), child.getName()))
                        .toList());
    }

    /** 카테고리 목록. 최상위만 담고 하위는 그 상위의 {@code children}에 넣는다. 나누지 않고 전부 담는다(ADR 002 3절). */
    @Schema(name = "CategoryItems")
    record Items(List<CategoryResponse> items) {

        /**
         * {@code categories}는 {@code CategoryService.list}의 순서(미분류가 뒤, 만든 시각, id)다. 최상위는 구분으로만
         * 다시 놓고(안정 정렬이라 구분 안의 순서는 그대로다) 하위는 상위마다 받은 순서대로 모은다.
         */
        static Items of(List<Category> categories) {
            Map<UUID, List<Child>> children = categories.stream()
                    .filter(category -> !category.isTopLevel())
                    .collect(Collectors.groupingBy(Category::getParentId, Collectors.mapping(
                            child -> new Child(child.getId(), child.getName()), Collectors.toList())));
            return new Items(categories.stream()
                    .filter(Category::isTopLevel)
                    .sorted(Comparator.comparingInt(top -> KIND_ORDER.indexOf(top.getKind())))
                    .map(top -> new CategoryResponse(top.getId(), top.getKind(), top.getName(), top.isSystem(),
                            children.getOrDefault(top.getId(), List.of())))
                    .toList());
        }
    }
}
