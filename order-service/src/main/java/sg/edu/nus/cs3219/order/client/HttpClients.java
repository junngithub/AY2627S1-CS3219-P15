package sg.edu.nus.cs3219.order.client;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.time.Duration;
import java.util.UUID;

@Component
@ConditionalOnProperty(name = "order.clients.mode", havingValue = "http")
public class HttpClients implements UserClient, CreditClient, SupplierClient, RatingClient, AdminClient {

    private final RestClient users;
    private final RestClient credits;
    private final RestClient suppliers;
    private final RestClient ratings;
    private final RestClient admins;

    public HttpClients(OrderProperties properties) {
        Duration timeout = properties.getClients().getTimeout();
        this.users = client(properties.getClients().getUserBaseUrl(), timeout);
        this.credits = client(properties.getClients().getCreditBaseUrl(), timeout);
        this.suppliers = client(properties.getClients().getSupplierBaseUrl(), timeout);
        this.ratings = client(properties.getClients().getRatingBaseUrl(), timeout);
        this.admins = client(properties.getClients().getAdminBaseUrl(), timeout);
    }

    @Override
    public UserAccount authenticate(String authorizationHeader) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            throw ApiException.unauthorized("Sign in is required");
        }
        try {
            AuthorizeResponse authorized = users.post()
                    .uri("/api/v1/user/authorize")
                    .header("Authorization", authorizationHeader)
                    .retrieve()
                    .body(AuthorizeResponse.class);
            if (authorized == null || !authorized.authenticated() || authorized.userId() == null || authorized.userId().isBlank()) {
                throw ApiException.unauthorized("Sign in is required");
            }
            ProfileResponse profile = users.get()
                    .uri("/api/v1/user/me")
                    .header("Authorization", authorizationHeader)
                    .retrieve()
                    .body(ProfileResponse.class);
            if (profile == null || profile.email() == null || profile.email().isBlank()) {
                throw ApiException.unauthorized("Sign in is required");
            }
            String handle = profile.telegramHandle();
            if (handle == null || handle.isBlank()) {
                handle = profile.name();
            }
            if (handle == null || handle.isBlank()) {
                handle = profile.email().substring(0, profile.email().indexOf('@'));
            }
            return new UserAccount(authorized.userId(), profile.email(), handle);
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 401 || exception.getStatusCode().value() == 403) {
                throw ApiException.unauthorized("Sign in is required");
            }
            throw ApiException.unavailable("User service did not respond in time");
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("User service did not respond in time");
        }
    }

    @Override
    public void reserve(UUID orderId, String requesterId, int amount, String authorization) {
        try {
            credits.post()
                    .uri("/api/v1/credit/reserve")
                    .header("Authorization", authorization)
                    .body(new ReserveRequest(orderId, requesterId, amount))
                    .retrieve()
                    .toBodilessEntity();
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Credit service did not respond in time");
        }
    }

    @Override
    public void returnReserved(UUID orderId, String authorization) {
        try {
            credits.post()
                    .uri("/api/v1/credit/release")
                    .header("Authorization", authorization)
                    .body(new ReleaseRequest(orderId))
                    .retrieve()
                    .toBodilessEntity();
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Credit service did not respond in time");
        }
    }

    @Override
    public Place requirePlace(String locationId, String authorization) {
        try {
            SupplierResponse supplier = suppliers.get()
                    .uri("/api/v1/supplier/{id}", locationId)
                    .header("Authorization", authorization)
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
    public double ratingFor(String userId, String authorization) {
        try {
            RatingResponse response = ratings.get()
                    .uri("/api/v1/rating/{userId}", userId)
                    .header("Authorization", authorization)
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
    public void escalate(OrderContext order, String authorization) {
        try {
            admins.post()
                    .uri("/escalations")
                    .header("Authorization", authorization)
                    .body(order)
                    .retrieve()
                    .toBodilessEntity();
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Admin service did not respond in time");
        }
    }

    private static RestClient client(String baseUrl, Duration timeout) {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory();
        factory.setReadTimeout(timeout);
        return RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .messageConverters(converters -> converters.add(new MappingJackson2HttpMessageConverter()))
                .build();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record AuthorizeResponse(boolean authenticated, String userId, boolean isAdmin, String permittedAction) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ProfileResponse(String email, String name, String telegramHandle) {
    }

    private record ReserveRequest(UUID orderId, String requesterId, int amount) {
    }

    private record ReleaseRequest(UUID orderId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record SupplierResponse(String id, String name, double latitude, double longitude) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RatingResponse(double average) {
    }

}
