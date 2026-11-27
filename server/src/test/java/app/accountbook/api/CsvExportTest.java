package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** CSV 쓰기(#57): BOM, 머리, CRLF, RFC 4180의 따옴표, 수식 주입 막기. DB와 스프링 없이 돈다. */
class CsvExportTest {

    @Test
    void BOM_다음에_머리와_행을_CRLF로_쓰고_빈_칸은_비운다() throws Exception {
        ExportRow row = new ExportRow(LocalDate.of(2026, 10, 31), LocalTime.of(23, 59), "지출", 16_500, null, "현금",
                null, "식비", "점심", "올래국수", null, "완료", "소유자", 1);
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        CsvExport.write(List.of(row), out);

        byte[] bytes = out.toByteArray();
        assertThat(Arrays.copyOf(bytes, 3)).containsExactly(0xEF, 0xBB, 0xBF);
        assertThat(new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8)).isEqualTo(
                "날짜,시각,유형,금액,환불·돌려받음 구분,계좌,받는 계좌,상위 카테고리,하위 카테고리,가맹점/내용,메모,결제한 사람,상태,"
                        + "미확인 여부,이벤트,작성자,거래 번호\r\n"
                        + "2026-10-31,23:59,지출,16500,,현금,,식비,점심,올래국수,,,완료,,,소유자,1\r\n");
    }

    /** 칸 하나의 글자와 파일에 쓰이는 글자. 작은따옴표 뒤의 원래 글자는 그대로 남는다. */
    @ParameterizedTest
    @CsvSource(delimiter = '|', quoteCharacter = '`', value = {
            "국수, 만두|`\"국수, 만두\"`",
            "`\"맛집\"`|`\"\"\"맛집\"\"\"`",
            "=1+1|'=1+1",
            "+1|'+1",
            "-1|'-1",
            "@SUM(A1)|'@SUM(A1)",
            "＝1+1|'＝1+1", "＋1|'＋1", "－1|'－1", "＠A1|'＠A1",
            "=A1,B1|`\"'=A1,B1\"`",
            "`=HYPERLINK(\"x\")`|`\"'=HYPERLINK(\"\"x\"\")\"`"})
    void 쉼표와_큰따옴표는_따옴표로_감싸고_수식으로_읽힐_글자로_시작하면_작은따옴표를_붙인다(String value, String cell) {
        assertThat(CsvExport.cell(value)).isEqualTo(cell);
    }

    @Test
    void 탭_CR_줄바꿈도_같은_규칙이다() {
        assertThat(CsvExport.cell("\tcmd")).isEqualTo("'\tcmd");
        assertThat(CsvExport.cell("\r=1")).isEqualTo("\"'\r=1\"");
        assertThat(CsvExport.cell("첫 줄\n둘째 줄")).isEqualTo("\"첫 줄\n둘째 줄\"");
        assertThat(CsvExport.cell(null)).isEmpty();
        assertThat(CsvExport.cell("")).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"1+1", "a=b", "국수-만두", "'이미 따옴표", " =1+1", "2026-10-31", "16500"})
    void 맨_앞이_아니면_그대로다(String value) {
        assertThat(CsvExport.cell(value)).isEqualTo(value);
    }
}
