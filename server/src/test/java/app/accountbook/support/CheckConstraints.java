package app.accountbook.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * DB의 CHECK 제약 정의를 pg_constraint에서 읽어 값을 꺼낸다. 앱의 enum·상수와 DB 제약 값이 같은지 보는 테스트가 쓴다.
 * 정의는 PostgreSQL이 다시 쓴 모양(pg_get_constraintdef)이다. 모양이 예상과 다르면 값을 짐작하지 않고 실패한다.
 */
public final class CheckConstraints {

    /** 일치 테스트의 실패 문구 끝에 붙인다. */
    public static final String CHANGE_BOTH = "한쪽만 바꾸지 않는다. 앱 값을 바꾸는 PR은 그 CHECK를 바꾸는 새 마이그레이션"
            + "(ALTER TABLE ... DROP CONSTRAINT 그 이름, ADD CONSTRAINT 그 이름 CHECK (...))을 같이 올린다."
            + " main에 들어간 V 파일은 고치지 않는다(docs/db/migration-standards.md).";

    private final JdbcTemplate jdbc;

    private CheckConstraints(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public static CheckConstraints of(JdbcTemplate jdbc) {
        return new CheckConstraints(jdbc);
    }

    /** 그 테이블에 걸린 그 이름의 CHECK 정의. 예: {@code CHECK ((role = ANY (ARRAY['OWNER'::text, 'MEMBER'::text])))} */
    public String definition(String table, String constraint) {
        List<String> definitions = jdbc.queryForList("""
                select pg_get_constraintdef(c.oid)
                  from pg_constraint c
                  join pg_class t on t.oid = c.conrelid
                 where t.relname = ? and c.conname = ? and c.contype = 'c'
                """, String.class, table, constraint);
        assertThat(definitions).as("%s 테이블의 CHECK %s", table, constraint).hasSize(1);
        return definitions.getFirst();
    }

    /**
     * {@code col IN ('A', 'B')}로 건 CHECK의 값 목록. PostgreSQL은 이것을 {@code col = ANY (ARRAY['A'::text, 'B'::text])}로,
     * 값이 하나면 {@code col = 'A'::text}로 다시 쓴다. 다른 모양(NOT IN, 다른 컬럼, 다른 식이 붙은 것)이면 실패한다.
     */
    public List<String> allowedValues(String table, String constraint, String column) {
        String definition = definition(table, constraint);
        String col = "\"?" + Pattern.quote(column) + "\"?";
        String literal = "'[^']*'::text";
        Matcher list = Pattern.compile("CHECK \\(\\(" + col + " = ANY \\(ARRAY\\[(" + literal + "(?:, " + literal
                + ")*)\\]\\)\\)\\)").matcher(definition);
        Matcher single = Pattern.compile("CHECK \\(\\(" + col + " = (" + literal + ")\\)\\)").matcher(definition);
        String literals;
        if (list.matches()) {
            literals = list.group(1);
        } else if (single.matches()) {
            literals = single.group(1);
        } else {
            throw new AssertionError(constraint + "가 " + column + " IN (...) 모양이 아니다: " + definition);
        }
        return Pattern.compile("'([^']*)'::text").matcher(literals).results()
                .map(match -> match.group(1))
                .toList();
    }

    /**
     * CHECK 정의 안의 {@code (식 연산자 값)} 비교 하나에서 값을 꺼낸다. 따옴표와 형 표시(예: {@code '9999999999'::bigint},
     * {@code '2000-01-01'::date})는 뗀다. 그 비교가 없거나 둘 이상이면 실패한다.
     *
     * @param expression 정의에 적힌 그대로의 왼쪽 식. 예: {@code char_length(name)}, {@code amount}
     * @param operator   {@code >=}, {@code <=}, {@code <>} 등
     */
    public String comparedValue(String table, String constraint, String expression, String operator) {
        String definition = definition(table, constraint);
        List<String> values = Pattern.compile("\\(" + Pattern.quote(expression) + " " + Pattern.quote(operator)
                        + " '?([^')]+?)'?(?:::[a-z ]+)?\\)")
                .matcher(definition).results()
                .map(match -> match.group(1))
                .toList();
        assertThat(values).as("%s에서 (%s %s 값)을 찾는다: %s", constraint, expression, operator, definition)
                .hasSize(1);
        return values.getFirst();
    }

    public long comparedLong(String table, String constraint, String expression, String operator) {
        return Long.parseLong(comparedValue(table, constraint, expression, operator));
    }
}
