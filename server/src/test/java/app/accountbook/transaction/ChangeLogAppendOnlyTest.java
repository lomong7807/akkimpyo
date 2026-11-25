package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.common.BaseEntity;
import jakarta.persistence.Column;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Modifying;

/**
 * 이력을 고치거나 지우는 앱 경로가 없다(P-216, ADR 007 결정 2, 이슈 #60).
 * 지우는 경로는 거래 완전 삭제(#9)와 장부 영구 삭제, 고치는 경로는 탈퇴 정리뿐이고 아직 없다. 생길 때 이 테스트를 같이 고친다.
 */
class ChangeLogAppendOnlyTest {

    @Test
    void 저장소에는_더하고_읽는_메서드만_있다() {
        assertThat(ChangeLogRepository.class.getMethods())
                .isNotEmpty()
                .allSatisfy(method -> assertThat(method.getName()).matches("save|find.*|exists.*"))
                .noneMatch(method -> method.isAnnotationPresent(Modifying.class));
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
