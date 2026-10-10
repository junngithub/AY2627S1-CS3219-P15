package sg.edu.nus.cs3219.order.rest;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI orderServiceOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("Order Service")
                        .description("Friend on Campus errand orders. The API gateway sends the user id in X-User-Id. X-User-Telegram is optional until the order service loads the handle from User Service.")
                        .version("v1"))
                .addSecurityItem(new SecurityRequirement().addList(CallerHeaders.USER_ID))
                .components(new Components()
                        .addSecuritySchemes(CallerHeaders.USER_ID, header(CallerHeaders.USER_ID, "User id from the gateway."))
                        .addSecuritySchemes(CallerHeaders.TELEGRAM, header(CallerHeaders.TELEGRAM, "Telegram handle. Optional.")));
    }

    private static SecurityScheme header(String name, String description) {
        return new SecurityScheme()
                .name(name)
                .type(SecurityScheme.Type.APIKEY)
                .in(SecurityScheme.In.HEADER)
                .description(description);
    }
}
