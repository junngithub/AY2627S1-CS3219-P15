package sg.edu.nus.cs3219.order.client;

import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;
import sg.edu.nus.cs3219.order.rest.CallerHeaders;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.UUID;

@Component
public class HttpClients implements CreditClient, SupplierClient {

    private static final String NOT_APPROVED = "That location is not an approved supplier";

    private final RestClient credits;
    private final RestClient suppliers;

    public HttpClients(OrderProperties properties) {
        Duration timeout = properties.getClients().getTimeout();
        this.credits = client(properties.getClients().getCreditBaseUrl(), timeout);
        this.suppliers = client(properties.getClients().getSupplierBaseUrl(), timeout);
    }

    @Override
    public void reserve(UUID orderId, String requesterId, int amount, UserAccount caller) {
        try {
            credits.post()
                    .uri("/api/v1/credit/reserve")
                    .headers(headers -> identify(headers, caller))
                    .body(new ReserveRequest(orderId, requesterId, amount))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException exception) {
            throw creditFailure(exception);
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Credit service did not respond in time");
        }
    }

    @Override
    public void returnReserved(UUID orderId, UserAccount caller) {
        try {
            credits.post()
                    .uri("/api/v1/credit/release")
                    .headers(headers -> identify(headers, caller))
                    .body(new ReleaseRequest(orderId))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException exception) {
            throw creditFailure(exception);
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Credit service did not respond in time");
        }
    }

    @Override
    public Place requirePlace(String locationId, UserAccount caller) {
        try {
            SupplierResponse supplier = suppliers.get()
                    .uri("/api/v1/supplier/{id}", locationId)
                    .headers(headers -> identify(headers, caller))
                    .retrieve()
                    .body(SupplierResponse.class);
            if (supplier == null || supplier.id() == null || supplier.name() == null || supplier.name().isBlank()
                    || !"approved".equals(supplier.status())) {
                throw ApiException.badRequest(NOT_APPROVED);
            }
            return new Place(supplier.id().toString(), supplier.name(), supplier.latitude(), supplier.longitude());
        } catch (RestClientResponseException exception) {
            int status = exception.getStatusCode().value();
            if (status == 400 || status == 404) {
                throw ApiException.badRequest(NOT_APPROVED);
            }
            throw ApiException.unavailable("Supplier service could not complete the request");
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Supplier service did not respond in time");
        }
    }

    private static ApiException creditFailure(RestClientResponseException exception) {
        return switch (creditCode(exception)) {
            case "CREDIT_INSUFFICIENT_BALANCE" -> ApiException.badRequest("Not enough credits for this reward");
            case "CREDIT_INVALID_AMOUNT" -> ApiException.badRequest("The reward must be a positive number of credits");
            case "CREDIT_ORDER_NOT_FOUND" -> ApiException.badRequest("No reserved credits were found for this order");
            case "CREDIT_ORDER_ALREADY_RESERVED" -> ApiException.conflict("This order already has reserved credits");
            case "CREDIT_USER_NOT_FOUND" -> ApiException.notFound("That user has no credit account");
            default -> ApiException.unavailable("Credit service could not complete the request");
        };
    }

    private static String creditCode(RestClientResponseException exception) {
        try {
            JsonNode code = JsonMapper.shared().readTree(exception.getResponseBodyAsString()).get("code");
            if (code == null || code.isNull()) {
                return "";
            }
            return code.asString();
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private static void identify(HttpHeaders headers, UserAccount caller) {
        headers.set(CallerHeaders.USER_ID, caller.userId());
        if (caller.telegramHandle() != null && !caller.telegramHandle().isBlank()) {
            headers.set(CallerHeaders.TELEGRAM, caller.telegramHandle());
        }
    }

    private static RestClient client(String baseUrl, Duration timeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(timeout);
        factory.setReadTimeout(timeout);
        JsonMapper json = JsonMapper.builder()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .build();
        return RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .configureMessageConverters(converters -> converters.withJsonConverter(new JacksonJsonHttpMessageConverter(json)))
                .build();
    }

    private record ReserveRequest(UUID orderId, String requesterId, int amount) {
    }

    private record ReleaseRequest(UUID orderId) {
    }

    private record SupplierResponse(Integer id, String name, double latitude, double longitude, String status) {
    }
}
