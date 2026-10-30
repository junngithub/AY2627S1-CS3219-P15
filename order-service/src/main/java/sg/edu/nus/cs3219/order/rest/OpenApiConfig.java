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
                        .description("Friend on Campus errand orders. The API gateway sends X-User-Id and X-Permitted-Action. Telegram handles are loaded from User Service when an order is created or accepted.")
                        .version("v1"))
                .addSecurityItem(new SecurityRequirement()
                        .addList(CallerHeaders.USER_ID)
                        .addList(CallerHeaders.PERMITTED))
                .components(new Components()
                        .addSecuritySchemes(CallerHeaders.USER_ID, header(CallerHeaders.USER_ID, "User id from the gateway."))
                        .addSecuritySchemes(CallerHeaders.PERMITTED, header(CallerHeaders.PERMITTED, "true when the account may use orders.")));
    }

    private static SecurityScheme header(String name, String description) {
        return new SecurityScheme()
                .name(name)
                .type(SecurityScheme.Type.APIKEY)
                .in(SecurityScheme.In.HEADER)
                .description(description);
    }
}
