package sg.edu.nus.cs3219.order.client;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import sg.edu.nus.cs3219.order.rest.CallerHeaders;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.time.Duration;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "order.clients.mode", havingValue = "http")
public class HttpClients implements CreditClient, SupplierClient, RatingClient, AdminClient {

    private final RestClient credits;
    private final RestClient suppliers;
    private final RestClient ratings;
    private final RestClient admins;

    public HttpClients(OrderProperties properties) {
        Duration timeout = properties.getClients().getTimeout();
        this.credits = client(properties.getClients().getCreditBaseUrl(), timeout);
        this.suppliers = client(properties.getClients().getSupplierBaseUrl(), timeout);
        this.ratings = client(properties.getClients().getRatingBaseUrl(), timeout);
        this.admins = client(properties.getClients().getAdminBaseUrl(), timeout);
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
            if (supplier == null || supplier.name() == null || supplier.name().isBlank()) {
                throw ApiException.badRequest("That location is not an approved supplier");
            }
            String id = supplier.id() == null || supplier.id().isBlank() ? locationId : supplier.id();
            return new Place(id, supplier.name(), supplier.latitude(), supplier.longitude());
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 404) {
                throw ApiException.badRequest("That location is not an approved supplier");
            }
            throw ApiException.unavailable("Supplier service did not respond in time");
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Supplier service did not respond in time");
        }
    }

    @Override
    public double ratingFor(String userId, UserAccount caller) {
        try {
            RatingResponse response = ratings.get()
                    .uri("/api/v1/rating/{userId}", userId)
                    .headers(headers -> identify(headers, caller))
                    .retrieve()
                    .body(RatingResponse.class);
            if (response == null) {
                throw ApiException.unavailable("Rating service did not respond in time");
            }
            return response.average();
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Rating service did not respond in time");
        }
    }

    @Override
    public void escalate(OrderContext order, UserAccount caller) {
        try {
            admins.post()
                    .uri("/escalations")
                    .headers(headers -> identify(headers, caller))
                    .body(order)
                    .retrieve()
                    .toBodilessEntity();
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Admin service did not respond in time");
        }
    }

    private static void identify(HttpHeaders headers, UserAccount caller) {
        headers.set(CallerHeaders.USER_ID, caller.userId());
        headers.set(CallerHeaders.EMAIL, caller.email());
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

    private record SupplierResponse(String id, String name, double latitude, double longitude) {
    }

    private record RatingResponse(double average) {
    }

}
