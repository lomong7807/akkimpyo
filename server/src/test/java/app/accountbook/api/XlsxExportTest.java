package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * 엑셀 쓰기(#57). 만든 파일을 풀어 시트 XML을 읽는다: 가맹점·메모·이름은 글자 칸이고 수식 칸은 없으며, 금액과 거래 번호는 숫자
 * 칸, 날짜는 날짜 서식의 숫자 칸이다. DB와 스프링 없이 돈다.
 */
class XlsxExportTest {

    @Test
    void 가맹점과_메모와_이름은_수식으로_시작해도_원래_글자의_글자_칸이고_수식_칸은_없다() throws Exception {
        ExportRow row = new ExportRow(LocalDate.of(2026, 10, 31), LocalTime.of(23, 59), "지출", 16_500, null, "-비상금",
                null, "+간식", null, "=HYPERLINK(\"x\")", "@SUM(A1)", "완료", "=작성자", 7);
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        XlsxExport.write(List.of(row), out);

        Map<String, Cell> cells = cells(out.toByteArray());
        NodeList formats = parts(out.toByteArray()).get("xl/styles.xml").getElementsByTagName("numFmt");
        assertThat(cells.values()).noneMatch(Cell::formula);
        assertThat(List.of("F2", "H2", "J2", "K2", "P2")).allSatisfy(ref -> assertThat(cells.get(ref).type()).isEqualTo("s"));
        assertThat(List.of("F2", "H2", "J2", "K2", "P2")).map(ref -> cells.get(ref).text())
                .containsExactly("-비상금", "+간식", "=HYPERLINK(\"x\")", "@SUM(A1)", "=작성자");
        assertThat(cells.get("D2")).isEqualTo(new Cell("n", "16500", null, false));
        assertThat(cells.get("Q2")).isEqualTo(new Cell("n", "7", null, false));
        // 2026-10-31의 엑셀 날짜 번호. 서식을 단 칸은 날짜 칸뿐이고 그 서식이 yyyy-mm-dd다.
        assertThat(cells.get("A2").text()).isEqualTo("46326.0");
        assertThat(cells.get("A2").style()).isNotNull();
        assertThat(formats.getLength()).isOne();
        assertThat(((Element) formats.item(0)).getAttribute("formatCode")).isEqualTo("yyyy-mm-dd");
        assertThat(cells.get("B2").text()).isEqualTo("23:59");
        assertThat(cells).doesNotContainKeys("E2", "G2", "I2", "L2", "N2", "O2");
    }

    @Test
    void 첫_행은_CSV와_같은_머리다() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        XlsxExport.write(List.of(), out);

        Map<String, Cell> cells = cells(out.toByteArray());
        assertThat(cells).hasSize(ExportRow.HEADER.size());
        assertThat(cells.get("A1").text()).isEqualTo("날짜");
        assertThat(cells.get("Q1").text()).isEqualTo("거래 번호");
    }

    /**
     * 첫 시트의 칸(이름 → 칸). 공유 문자열은 글자로 풀어 둔다. HTTP 테스트도 쓴다. 엑셀처럼 zip의 중앙 디렉터리로 읽는다
     * ({@code ZipInputStream}은 크기를 뒤에 적은 항목을 읽지 못한다).
     */
    static Map<String, Cell> cells(byte[] xlsx) throws Exception {
        Map<String, Document> parts = parts(xlsx);
        NodeList shared = parts.get("xl/sharedStrings.xml").getElementsByTagName("si");
        NodeList found = parts.get("xl/worksheets/sheet1.xml").getElementsByTagName("c");
        Map<String, Cell> cells = new HashMap<>();
        for (int i = 0; i < found.getLength(); i++) {
            Element cell = (Element) found.item(i);
            String type = cell.hasAttribute("t") ? cell.getAttribute("t") : null;
            String value = cell.getElementsByTagName("v").item(0).getTextContent();
            cells.put(cell.getAttribute("r"), new Cell(type, "s".equals(type)
                    ? shared.item(Integer.parseInt(value)).getTextContent() : value,
                    cell.hasAttribute("s") ? cell.getAttribute("s") : null, cell.getElementsByTagName("f").getLength() > 0));
        }
        return cells;
    }

    /** 파일 안의 XML 부분(경로 → 문서). */
    private static Map<String, Document> parts(byte[] xlsx) throws Exception {
        Path file = Files.write(Files.createTempFile("export", ".xlsx"), xlsx);
        Map<String, Document> parts = new HashMap<>();
        try (ZipFile zip = new ZipFile(file.toFile())) {
            for (ZipEntry entry : Collections.list(zip.entries())) {
                if (entry.getName().endsWith(".xml")) {
                    parts.put(entry.getName(), DocumentBuilderFactory.newInstance().newDocumentBuilder()
                            .parse(zip.getInputStream(entry)));
                }
            }
        } finally {
            Files.delete(file);
        }
        return parts;
    }

    /**
     * @param type  XML의 {@code t}: 글자(공유 문자열)는 {@code s}, 숫자는 {@code n}
     * @param style XML의 {@code s}(서식 번호). 서식이 없으면 {@code null}
     */
    record Cell(String type, String text, String style, boolean formula) {
    }
}
