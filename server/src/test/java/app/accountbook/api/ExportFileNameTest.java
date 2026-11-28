package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** 내보낸 파일의 이름과 Content-Disposition(#57). DB와 스프링 없이 돈다. */
class ExportFileNameTest {

    private static final LocalDate FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate TO = LocalDate.of(2026, 12, 31);

    @Test
    void 이름은_장부_이름_시작일_종료일이고_못_쓰는_글자와_제어_글자는_밑줄이다() {
        assertThat(ExportFileName.of("내 가계부", FROM, TO, "csv")).isEqualTo("내 가계부_20260101_20261231.csv");
        assertThat(ExportFileName.of("a/b\\c:d*e?f\"g<h>i|j", FROM, TO, "csv"))
                .isEqualTo("a_b_c_d_e_f_g_h_i_j_20260101_20261231.csv");
        assertThat(ExportFileName.of("가\t나\n다\u007F라", FROM, TO, "csv")).isEqualTo("가_나_다_라_20260101_20261231.csv");
    }

    /** ASCII 이름에서 ASCII 밖의 글자는 코드포인트마다 밑줄 하나다(이모지처럼 두 char인 글자도). */
    @Test
    void 헤더는_UTF8_filename_별표와_ASCII_filename을_함께_쓴다() {
        assertThat(ExportFileName.attachment("내 가계부_20260101_20261231.csv")).isEqualTo(
                "attachment; filename=\"_ ____20260101_20261231.csv\"; "
                        + "filename*=UTF-8''%EB%82%B4%20%EA%B0%80%EA%B3%84%EB%B6%80_20260101_20261231.csv");
        assertThat(ExportFileName.attachment("Family (2026)_😀.csv")).isEqualTo(
                "attachment; filename=\"Family (2026)__.csv\"; filename*=UTF-8''Family%20%282026%29_%F0%9F%98%80.csv");
    }
}
