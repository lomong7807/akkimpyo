package app.accountbook.api;

import app.accountbook.ledger.LedgerAccess;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** 장부 경로의 구성원 확인({@link LedgerMemberInterceptor})을 건다. */
@Configuration(proxyBeanMethods = false)
class LedgerPathConfig implements WebMvcConfigurer {

    private final LedgerAccess ledgerAccess;

    LedgerPathConfig(LedgerAccess ledgerAccess) {
        this.ledgerAccess = ledgerAccess;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new LedgerMemberInterceptor(ledgerAccess))
                .addPathPatterns(LedgerMemberInterceptor.PATH);
    }
}
