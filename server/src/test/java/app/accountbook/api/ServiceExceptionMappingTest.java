package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.lang.reflect.Method;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.method.annotation.ExceptionHandlerMethodResolver;

/** 서비스 예외가 새로 생겼는데 응답을 정하지 않아 500으로 나가는 일을 막는다(ADR 002 5절). */
class ServiceExceptionMappingTest {

    /**
     * 처리기에 없는 예외. 던지는 서비스를 처음 API로 여는 이슈가 403, 409로 잇고 여기서 지운다(#12 범위 밖). 다만
     * {@code IdConflictException}과 {@code StaleVersionException}은 API가 {@code current}에 표시 이름을 붙여
     * {@link TransactionIdConflict}, {@link TransactionStaleVersion}으로 바꿔 던지므로 여기 남는다(#14, #36).
     */
    private static final List<String> NOT_MAPPED_YET = List.of(
            "IdConflictException", "InUseException", "NotLedgerOwnerException", "StaleVersionException");

    private final ExceptionHandlerMethodResolver resolver =
            new ExceptionHandlerMethodResolver(ApiExceptionHandler.class);

    @Test
    void 서비스_예외는_모두_응답이_정해져_있다() {
        Method fallback = resolver.resolveMethodByExceptionType(Exception.class);
        assertThat(fallback).isNotNull();

        List<String> unmapped = serviceExceptions().stream()
                .filter(type -> resolver.resolveMethodByExceptionType(type).equals(fallback))
                .map(Class::getSimpleName)
                .sorted()
                .toList();

        assertThat(unmapped).isEqualTo(NOT_MAPPED_YET);
    }

    private static List<Class<? extends Throwable>> serviceExceptions() {
        List<Class<? extends Throwable>> types = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("app.accountbook")
                .stream()
                .filter(type -> type.isAssignableTo(Throwable.class))
                .map(JavaClass::reflect)
                .<Class<? extends Throwable>>map(type -> type.asSubclass(Throwable.class))
                .toList();
        assertThat(types).as("예외를 실제로 찾았다").hasSizeGreaterThan(10);
        return types;
    }
}
