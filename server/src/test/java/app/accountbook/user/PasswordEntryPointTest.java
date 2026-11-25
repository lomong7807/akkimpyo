package app.accountbook.user;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/**
 * 비밀번호를 해시하고 비교하는 입구는 {@link PasswordHasher} 하나다(#20, PR #157의 security 검토).
 * 해시 라이브러리를 직접 쓰면 정규화, 동시 해시 상한, 저장값 판정을 거치지 않는다. 검사 대상은 main 코드만이다.
 */
@AnalyzeClasses(packages = "app.accountbook", importOptions = ImportOption.DoNotIncludeTests.class)
class PasswordEntryPointTest {

    @ArchTest
    static final ArchRule 비밀번호_해시_라이브러리는_입구와_그_설정만_참조한다 =
            noClasses().that().doNotBelongToAnyOf(PasswordHasher.class, PasswordEncoderConfig.class)
                    .should().dependOnClassesThat().resideInAPackage("org.springframework.security.crypto..");
}
