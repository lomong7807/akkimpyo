package app.accountbook.category;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import java.util.stream.Stream;

/**
 * 장부를 만들 때 넣는 기본 카테고리(P-223): 지출 11개, 수입 4개, 그리고 지출과 수입의 미분류(P-204).
 * 이름과 순서는 기능정의서에 적힌 그대로다. 모두 최상위이고 미분류만 system이다.
 */
final class DefaultCategories {

    private static final List<String> EXPENSE_NAMES = List.of(
            "식비", "카페·간식", "교통", "주거·통신", "생활용품", "의료·건강", "문화·여가", "쇼핑", "경조사·선물", "교육", "기타");

    private static final List<String> INCOME_NAMES = List.of("급여", "부수입", "용돈", "기타");

    private record Spec(CategoryKind kind, String name, boolean system) {
    }

    /** 지출, 수입, 미분류(지출, 수입) 순서다. 구분별로 보면 미분류가 맨 뒤에 온다(F-509). */
    private static final List<Spec> SPECS = Stream.of(
                    EXPENSE_NAMES.stream().map(name -> new Spec(CategoryKind.EXPENSE, name, false)),
                    INCOME_NAMES.stream().map(name -> new Spec(CategoryKind.INCOME, name, false)),
                    Stream.of(CategoryKind.EXPENSE, CategoryKind.INCOME)
                            .map(kind -> new Spec(kind, Category.UNCATEGORIZED_NAME, true)))
            .flatMap(specs -> specs)
            .toList();

    private DefaultCategories() {
    }

    /**
     * 그 장부의 기본 카테고리를 명세 순서대로 돌려준다(저장은 하지 않는다).
     * 카테고리 목록은 미분류가 아닌 것끼리 created_at 순이고 같으면 id 순인데, 한꺼번에 만들면 시각이 같아져
     * 명세 순서가 아니라 무작위 id 순이 된다. 그래서 만든 시각을 firstCreatedAt부터 1마이크로초(DB 정밀도)씩 늘려 준다.
     */
    static List<Category> forLedger(UUID ledgerId, Instant firstCreatedAt) {
        return IntStream.range(0, SPECS.size())
                .mapToObj(index -> {
                    Spec spec = SPECS.get(index);
                    return Category.ofDefault(ledgerId, spec.kind(), spec.name(), spec.system(),
                            firstCreatedAt.plus(index, ChronoUnit.MICROS));
                })
                .toList();
    }
}
