package app.accountbook;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import app.accountbook.account.AccountUsage;
import app.accountbook.category.CategoryUsage;
import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaAccess;
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
import org.springframework.data.repository.Repository;

/**
 * ADR 004(모듈 경계와 의존 규칙)의 결정 3, 4와, api가 권한을 확인하지 않는 길로 장부 데이터에 닿지 않는 것(#13)을 검사한다.
 * 모듈은 {@code app.accountbook} 바로 아래 패키지이고, 검사 대상은 main 코드만이다.
 */
@AnalyzeClasses(packages = ModuleBoundaryTest.ROOT, importOptions = ImportOption.DoNotIncludeTests.class)
class ModuleBoundaryTest {

    static final String ROOT = "app.accountbook";

    /**
     * ADR 004 결정 3: 모듈마다 참조해도 되는 다른 모듈. 방향을 더하거나 모듈을 추가할 때는 ADR을 먼저 고친다.
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
            "api", Set.of("common", "account", "auth", "category", "ledger", "stats", "transaction", "user"),
            "demo", Set.of("common", "account", "category", "ledger", "transaction", "user"));

    @ArchTest
    static final ArchRule 최상위_패키지_사이에_순환_의존이_없다 =
            slices().matching(ROOT + ".(*)..").should().beFreeOfCycles();

    @ArchTest
    static final ArchRule 모듈은_허용_목록에_있는_모듈만_참조한다 =
            classes().that().resideInAPackage(ROOT + ".*..").should(onlyDependOnAllowedModules());

    /**
     * 호출자(actorId)를 받지 않아 권한을 확인하지 않는 메서드 가운데 api가 부르면 안 되는 것(#13 구현 메모 3).
     * {@link ServiceMethodInventoryTest#NO_ACTOR_ALLOWED}의 나머지는 api가 호출자를 정하기 전에 부르는 것이다(토큰 확인, 로그인).
     */
    static final Set<String> NOT_FOR_API = Set.of("CategoryService.uncategorized", "UserService.createUser");

    /**
     * api는 리포지토리, 삭제용 포트(AccountUsage, CategoryUsage와 그 구현), {@link #NOT_FOR_API}를 직접 쓰지 않는다.
     * 이것들은 구성원 확인을 하지 않으므로 서비스가 확인한 뒤에 부른다(security, PR #142 검토).
     */
    @ArchTest
    static final ArchRule api는_권한을_확인하지_않는_길로_데이터에_닿지_않는다 =
            noClasses().that().resideInAPackage(ROOT + ".api..")
                    .should().dependOnClassesThat().areAssignableTo(Repository.class)
                    .orShould().dependOnClassesThat().areAssignableTo(AccountUsage.class)
                    .orShould().dependOnClassesThat().areAssignableTo(CategoryUsage.class)
                    .orShould().accessTargetWhere(DescribedPredicate.describe("권한을 확인하지 않는 " + NOT_FOR_API,
                            (JavaAccess<?> access) -> NOT_FOR_API.contains(
                                    access.getTargetOwner().getSimpleName() + "." + access.getName())));

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
