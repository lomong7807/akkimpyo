package app.accountbook.transaction;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.common.BaseEntity;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import jakarta.persistence.Column;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/**
 * 이력을 고치거나 지우는 앱 경로는 정리 경로뿐이다(P-216, ADR 007 결정 2, 이슈 #60).
 * 지우는 경로는 거래 완전 삭제와 30일 자동 삭제(#9)가 쓰는 {@link TransactionPurgeRepository} 하나다. 장부 영구 삭제와
 * 탈퇴 정리(고치는 경로)는 아직 없다. 생길 때 이 테스트를 같이 고친다.
 */
class ChangeLogAppendOnlyTest {

    static final JavaClasses APP = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("app.accountbook");
    static final Pattern WRITES_LOG = Pattern.compile("(?is).*\\b(delete\\s+from|update)\\s+change_?log\\b.*");

    @Test
    void 저장소에는_더하고_읽는_메서드만_있다() {
        assertThat(ChangeLogRepository.class.getMethods())
                .isNotEmpty()
                .allSatisfy(method -> assertThat(method.getName()).matches("save|find.*|exists.*"))
                .noneMatch(method -> method.isAnnotationPresent(Modifying.class));
    }

    @Test
    void 이력을_지우는_쿼리는_완전_삭제_저장소의_하나뿐이다() {
        assertThat(APP.stream()
                .flatMap(type -> type.getMethods().stream())
                .filter(method -> method.isAnnotatedWith(Query.class))
                .filter(method -> WRITES_LOG.matcher(method.getAnnotationOfType(Query.class).value()).matches())
                .map(method -> method.getOwner().getSimpleName() + "." + method.getName()))
                .containsExactly("TransactionPurgeRepository.deleteLogs");
    }

    /** 완전 삭제 저장소는 사람이 한 완전 삭제와 자동 삭제만 쓴다. 다른 경로가 이력을 지울 수 없다. */
    @Test
    void 완전_삭제_저장소는_완전_삭제와_자동_삭제만_쓴다() {
        noClasses().that().doNotBelongToAnyOf(TransactionPurgeRepository.class, TransactionService.class,
                        TrashAutoPurge.class)
                .should().dependOnClassesThat().belongToAnyOf(TransactionPurgeRepository.class)
                .check(APP);
    }

    /** save에 이미 저장된 행을 넘겨도 UPDATE가 나가지 않는다. 바꿀 수 있는 열도 세터도 없다. */
    @Test
    void 저장된_이력은_바뀌지_않는다() {
        assertThat(Stream.of(ChangeLog.class, BaseEntity.class)
                .flatMap(type -> Arrays.stream(type.getDeclaredFields()))
                .filter(field -> field.isAnnotationPresent(Column.class)))
                .isNotEmpty()
                .allMatch(field -> !field.getAnnotation(Column.class).updatable());
        assertThat(ChangeLog.class.getMethods()).extracting(Method::getName)
                .noneMatch(name -> name.startsWith("set"));
    }
}
