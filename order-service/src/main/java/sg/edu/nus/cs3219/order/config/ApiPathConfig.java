/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service configuration under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerTypePredicate;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import sg.edu.nus.cs3219.order.rest.CallerArgumentResolver;

import java.util.List;

@Configuration
public class ApiPathConfig implements WebMvcConfigurer {

    private final OrderProperties properties;

    public ApiPathConfig(OrderProperties properties) {
        this.properties = properties;
    }

    @Override
    public void configurePathMatch(PathMatchConfigurer configurer) {
        configurer.addPathPrefix(
                properties.getApi().getBasePath(),
                HandlerTypePredicate.forBasePackage("sg.edu.nus.cs3219.order.rest"));
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CallerArgumentResolver());
    }
}
