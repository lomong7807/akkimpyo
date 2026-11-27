package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Controller;

/**
 * 서비스와 조회 클래스의 공개 메서드 목록을 리플렉션으로 읽어, 호출자(actorId)를 받지 않는 공개 메서드가
 * 허용 목록 밖에 생기지 않게 한다(이슈 #19, PR #134의 security 권고 1).
 *
 * <p>호출자를 받는 메서드가 {@link CrossLedgerAccessTest}의 표에 빠짐없이 있는지는 그 테스트의 마지막 줄이
 * {@link #actorMethodNames()}와 대조한다.
 *
 * <p>대상은 손으로 나열하지 않는다. main 코드의 {@code app.accountbook} 아래에서 스프링 빈이 되는 클래스
 * ({@code @Component}와 그것을 품은 {@code @Service} 등)를 모두 찾고, 설정({@code @Configuration})과
 * 컨트롤러({@code @Controller})만 뺀다. 메서드는 시그니처가 아니라 "클래스.메서드" 이름으로 다룬다.
 * 스프링 컨텍스트와 DB는 쓰지 않는다.
 */
class ServiceMethodInventoryTest {

    static final String ROOT = "app.accountbook";

    /**
     * 호출자를 받지 않아도 되는 공개 메서드와 그 이유. 여기 있는 메서드는 권한을 확인하지 않으므로
     * 컨트롤러가 요청에서 받은 id를 그대로 넘겨 부르면 안 된다. 줄을 더할 때는 security 검토를 받는다.
     */
    static final Map<String, String> NO_ACTOR_ALLOWED = Map.of(
            "CategoryService.uncategorized",
            "TransactionService가 구성원 확인 뒤에 부르는 내부용 조회. 다른 패키지에서 불러 공개 범위를 좁힐 수 없다",
            "UserService.createUser",
            "가입. 아직 호출자가 없다",
            "UserService.authenticate",
            "로그인에서 호출자를 알아내는 메서드 자체다(ADR 001 결정 7). 사용자 id를 받지 않고, 이메일과 비밀번호가 맞을 때만 그 사용자의 id를 준다",
            "UserService.exists",
            "토큰의 사용자가 아직 있는지 요청마다 보는 조회(ADR 001 결정 1). 호출자를 정하기 전이고 있다/없다만 답한다",
            "LoginService.login",
            "로그인. 아직 호출자가 없다. 사용자 id를 받지 않고, 이메일과 비밀번호가 맞을 때만 그 사용자의 토큰을 준다",
            "LoginService.signup",
            "가입. 아직 호출자가 없다. 사용자 id를 받지 않고, user의 가입(입력 규칙, 허용 목록, 중복)을 지나 새로 만든 사용자의 "
                    + "토큰만 준다",
            "AccessTokenVerifier.verify",
            "access token에서 호출자를 알아내는 메서드 자체다. 사용자 id를 받지 않는다",
            "TransactionAccountUsage.isUsed",
            "계좌 삭제 제한용 포트(AccountUsage) 구현. AccountService가 구성원 확인 뒤에 부른다",
            "TransactionCategoryUsage.isUsed",
            "카테고리 삭제 제한용 포트(CategoryUsage) 구현. CategoryService가 구성원 확인 뒤에 부른다",
            "RequiredDbSettings.postProcessAfterInitialization",
            "기동할 때 스프링이 부르는 BeanPostProcessor. DB 접속 변수가 있는지만 보고 장부 데이터를 다루지 않는다");

    @Test
    void 대상_클래스를_찾는다() {
        // 찾는 방법이 조용히 깨져 아무것도 검사하지 않는 일을 막는다. 새 클래스가 생겨도 고칠 필요는 없다.
        assertThat(inventory()).extracting(ServiceMethod::name)
                .contains("AccountService.list", "CategoryService.createDefaults", "TransactionService.get",
                        "BalanceQuery.balance", "MonthlyStatsQuery.monthly", "LedgerAccess.requireMember");
    }

    @Test
    void 호출자를_받지_않는_공개_메서드는_허용_목록에만_있다() {
        Set<String> withoutActor = inventory().stream()
                .filter(method -> !method.actorFirst())
                .map(ServiceMethod::name)
                .collect(Collectors.toSet());

        assertThat(withoutActor)
                .as("첫 인자가 UUID actorId가 아닌 공개 메서드. 새 메서드라면 actorId를 받아 권한을 확인하게 하고, "
                        + "지워졌거나 이름이 바뀐 것이라면 허용 목록을 고친다")
                .containsExactlyInAnyOrderElementsOf(NO_ACTOR_ALLOWED.keySet());
    }

    /** 호출자를 받는 공개 메서드의 이름. {@link CrossLedgerAccessTest}의 표가 모두 다뤄야 한다. */
    static Set<String> actorMethodNames() {
        return inventory().stream()
                .filter(ServiceMethod::actorFirst)
                .map(ServiceMethod::name)
                .collect(Collectors.toSet());
    }

    /** main 코드에서 빈이 되는 클래스(설정과 컨트롤러 제외)에 선언된 공개 메서드 전부. */
    static List<ServiceMethod> inventory() {
        return new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages(ROOT)
                .stream()
                .filter(ServiceMethodInventoryTest::isServiceOrQuery)
                .map(JavaClass::reflect)
                .flatMap(type -> Arrays.stream(type.getDeclaredMethods())
                        .filter(method -> Modifier.isPublic(method.getModifiers()) && !method.isSynthetic())
                        .map(method -> ServiceMethod.of(type, method)))
                .distinct()
                .sorted(Comparator.comparing(ServiceMethod::name))
                .toList();
    }

    private static boolean isServiceOrQuery(JavaClass type) {
        return !type.isInterface()
                && !type.isAnnotation()
                && type.isMetaAnnotatedWith(Component.class)
                && !type.isMetaAnnotatedWith(Configuration.class)
                && !type.isMetaAnnotatedWith(Controller.class);
    }

    /**
     * @param name       "클래스.메서드". 같은 이름의 메서드가 여럿이면 하나로 보고, 하나라도 호출자를 받지 않으면
     *                   둘 다 목록에 남아 규칙에 걸린다
     * @param actorFirst 첫 인자가 {@code UUID actorId}인가
     */
    record ServiceMethod(String name, boolean actorFirst) {

        static ServiceMethod of(Class<?> type, Method method) {
            return new ServiceMethod(type.getSimpleName() + "." + method.getName(), startsWithActor(method));
        }

        private static boolean startsWithActor(Method method) {
            if (method.getParameterCount() == 0) {
                return false;
            }
            Parameter first = method.getParameters()[0];
            assertThat(first.isNamePresent())
                    .as("인자 이름을 읽으려면 -parameters로 컴파일해야 한다(스프링 부트 Gradle 플러그인의 기본값)")
                    .isTrue();
            return first.getType() == UUID.class && first.getName().equals("actorId");
        }
    }
}
