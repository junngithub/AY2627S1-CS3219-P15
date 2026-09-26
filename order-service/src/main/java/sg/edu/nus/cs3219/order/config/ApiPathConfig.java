package sg.edu.nus.cs3219.order.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerTypePredicate;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

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
}
