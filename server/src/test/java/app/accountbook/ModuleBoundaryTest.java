package app.accountbook;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * ADR 004(모듈 경계와 의존 규칙)의 결정 3, 4를 검사한다.
 * 모듈은 {@code app.accountbook} 바로 아래 패키지이고, 검사 대상은 main 코드만이다.
 */
@AnalyzeClasses(packages = ModuleBoundaryTest.ROOT, importOptions = ImportOption.DoNotIncludeTests.class)
class ModuleBoundaryTest {

    static final String ROOT = "app.accountbook";

    /**
     * ADR 004 결정 3: 모듈마다 참조해도 되는 다른 모듈. 방향을 더하거나 모듈을 추가할 때는 ADR을 먼저 고친다.
     * api, auth는 아직 없는 패키지다. 생기는 순간부터 이 목록으로 검사된다.
     */
    static final Map<String, Set<String>> ALLOWED = Map.of(
            "common", Set.of(),
            "ledger", Set.of("common"),
            "account", Set.of("common", "ledger"),
            "category", Set.of("common", "ledger"),
            "transaction", Set.of("common", "account", "category", "ledger"),
            "user", Set.of("common", "ledger", "category"),
            "auth", Set.of("common", "user"),
            "stats", Set.of("common", "account", "category", "ledger", "transaction"),
            "api", Set.of("common", "account", "auth", "category", "ledger", "stats", "transaction", "user"));

    @ArchTest
    static final ArchRule 최상위_패키지_사이에_순환_의존이_없다 =
            slices().matching(ROOT + ".(*)..").should().beFreeOfCycles();

    @ArchTest
    static final ArchRule 모듈은_허용_목록에_있는_모듈만_참조한다 =
            classes().that().resideInAPackage(ROOT + ".*..").should(onlyDependOnAllowedModules());

    private static ArchCondition<JavaClass> onlyDependOnAllowedModules() {
        return new ArchCondition<>("ADR 004 결정 3의 허용 목록에 있는 모듈만 참조한다") {
            @Override
            public void check(JavaClass source, ConditionEvents events) {
                String from = moduleOf(source).orElseThrow();
                Set<String> allowed = ALLOWED.get(from);
                if (allowed == null) {
                    events.add(SimpleConditionEvent.violated(source,
                            source.getName() + "의 모듈 " + from + "이 허용 목록에 없다. ADR 004를 먼저 고친다."));
                    return;
                }
                source.getDirectDependenciesFromSelf().forEach(dependency ->
                        moduleOf(dependency.getTargetClass())
                                .filter(to -> !to.equals(from) && !allowed.contains(to))
                                .ifPresent(to -> events.add(SimpleConditionEvent.violated(dependency,
                                        from + " → " + to + " 금지: " + dependency.getDescription()))));
            }
        };
    }

    /** {@code app.accountbook.account.Account} → {@code account}. 루트 패키지의 클래스와 바깥 클래스는 모듈이 없다. */
    private static Optional<String> moduleOf(JavaClass javaClass) {
        String packageName = javaClass.getPackageName();
        if (!packageName.startsWith(ROOT + ".")) {
            return Optional.empty();
        }
        return Optional.of(packageName.substring(ROOT.length() + 1).split("\\.")[0]);
    }
}
