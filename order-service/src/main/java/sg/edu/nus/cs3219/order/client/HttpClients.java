/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service HTTP clients under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

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
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class HttpClients implements CreditClient, SupplierClient, UserClient, AdminClient, RatingClient {

    private static final String NOT_APPROVED = "That location is not an approved supplier";
    private static final String USER_FAILED = "User service could not complete the request";
    private static final String ADMIN_FAILED = "Admin service could not complete the request";

    private final RestClient credits;
    private final RestClient suppliers;
    private final RestClient users;
    private final RestClient admins;
    private final RestClient ratings;
    private final Duration supplierCacheTtl;
    private final Duration telegramCacheTtl;
    private final ConcurrentHashMap<String, CacheEntry<Place>> placeCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CacheEntry<String>> telegramCache = new ConcurrentHashMap<>();

    public HttpClients(OrderProperties properties) {
        Duration timeout = properties.getClients().getTimeout();
        this.credits = client(properties.getClients().getCreditBaseUrl(), timeout);
        this.suppliers = client(properties.getClients().getSupplierBaseUrl(), timeout);
        this.users = client(properties.getClients().getUserBaseUrl(), timeout);
        this.admins = client(properties.getClients().getAdminBaseUrl(), timeout);
        this.ratings = client(properties.getClients().getRatingBaseUrl(), timeout);
        this.supplierCacheTtl = nullToZero(properties.getClients().getSupplierCacheTtl());
        this.telegramCacheTtl = nullToZero(properties.getClients().getTelegramCacheTtl());
    }

    @Override
    public void reserve(UUID orderId, String requesterId, int amount, UserAccount caller) {
        try {
            credits.post()
                    .uri("/api/v1/credit/internal/reserve")
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
                    .uri("/api/v1/credit/internal/release")
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
    public String telegramHandle(String userId) {
        CacheEntry<String> cached = telegramCache.get(userId);
        if (cached != null && cached.fresh()) {
            return cached.value();
        }
        return fetchTelegramWithRetry(userId);
    }

    private String fetchTelegramWithRetry(String userId) {
        ApiException lastUnavailable = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                return fetchAndCacheTelegram(userId);
            } catch (RestClientResponseException exception) {
                ApiException mapped = userFailure(exception);
                if (!isTransientUnavailable(mapped) || attempt == 3) {
                    throw mapped;
                }
                lastUnavailable = mapped;
            } catch (ResourceAccessException exception) {
                lastUnavailable = ApiException.unavailable("User service did not respond in time");
                if (attempt == 3) {
                    throw lastUnavailable;
                }
            }
        }
        throw lastUnavailable != null ? lastUnavailable : ApiException.unavailable(USER_FAILED);
    }

    private String fetchAndCacheTelegram(String userId) {
        TelegramResponse response = users.get()
                .uri("/api/v1/user/internal/users/{userId}/telegram", userId)
                .retrieve()
                .body(TelegramResponse.class);
        if (response == null || response.telegramHandle() == null || response.telegramHandle().isBlank()) {
            throw ApiException.unavailable(USER_FAILED);
        }
        putTelegram(userId, response.telegramHandle());
        return response.telegramHandle();
    }

    @Override
    public void openConflict(UUID orderId, String reporterUserId, String comment, List<String> photos) {
        try {
            admins.post()
                    .uri("/api/v1/admin/internal/conflicts")
                    .body(new ConflictRequest(orderId.toString(), reporterUserId, comment, photos == null ? List.of() : photos))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException exception) {
            int status = exception.getStatusCode().value();
            if (status == 400 || status == 422) {
                throw ApiException.badRequest("Admin service rejected the escalation");
            }
            throw ApiException.unavailable(ADMIN_FAILED);
        } catch (ResourceAccessException exception) {
            throw ApiException.unavailable("Admin service did not respond in time");
        }
    }

    @Override
    public Double ratingFor(String userId, UserAccount caller) {
        try {
            RatingResponse response = ratings.get()
                    .uri("/api/v1/rating/{userId}", userId)
                    .headers(headers -> identify(headers, caller))
                    .retrieve()
                    .body(RatingResponse.class);
            if (response == null) {
                // Rating is optional on the order row; don't fail create/accept.
                return null;
            }
            return response.average();
        } catch (RestClientResponseException exception) {
            int status = exception.getStatusCode().value();
            if (status == 400) {
                throw ApiException.badRequest("A valid user id is required");
            }
            // Mesh/Rating blips were failing ~20% of creates; rating is nullable.
            return null;
        } catch (ResourceAccessException exception) {
            return null;
        }
    }

    @Override
    public Place requirePlace(String locationId, UserAccount caller) {
        CacheEntry<Place> cached = placeCache.get(locationId);
        if (cached != null && cached.fresh()) {
            return cached.value();
        }
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
            Place place = new Place(supplier.id().toString(), supplier.name(), supplier.latitude(), supplier.longitude());
            putPlace(locationId, place);
            return place;
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

    private void putPlace(String locationId, Place place) {
        if (supplierCacheTtl.isZero() || supplierCacheTtl.isNegative()) {
            return;
        }
        placeCache.put(locationId, new CacheEntry<>(place, System.currentTimeMillis() + supplierCacheTtl.toMillis()));
    }

    private void putTelegram(String userId, String handle) {
        if (telegramCacheTtl.isZero() || telegramCacheTtl.isNegative()) {
            return;
        }
        telegramCache.put(userId, new CacheEntry<>(handle, System.currentTimeMillis() + telegramCacheTtl.toMillis()));
    }

    private static Duration nullToZero(Duration duration) {
        return duration == null ? Duration.ZERO : duration;
    }

    private record CacheEntry<T>(T value, long expiresAtMs) {
        boolean fresh() {
            return System.currentTimeMillis() < expiresAtMs;
        }
    }

    private static ApiException userFailure(RestClientResponseException exception) {
        return switch (errorCode(exception)) {
            case "USER_NOT_FOUND" -> ApiException.notFound("That user was not found");
            case "USER_NOT_VERIFIED" -> ApiException.conflict("That user has not finished verification");
            case "INVALID_USER_ID" -> ApiException.badRequest("A valid user id is required");
            default -> ApiException.unavailable(USER_FAILED);
        };
    }

    private static boolean isTransientUnavailable(ApiException exception) {
        return exception.getStatus() == org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;
    }

    private static ApiException creditFailure(RestClientResponseException exception) {
        return switch (errorCode(exception)) {
            case "CREDIT_INSUFFICIENT_BALANCE" -> ApiException.badRequest("Not enough credits for this reward");
            case "CREDIT_INVALID_AMOUNT" -> ApiException.badRequest("The reward must be a positive number of credits");
            case "CREDIT_ORDER_NOT_FOUND" -> ApiException.badRequest("No reserved credits were found for this order");
            case "CREDIT_ORDER_ALREADY_RESERVED" -> ApiException.conflict("This order already has reserved credits");
            case "CREDIT_USER_NOT_FOUND" -> ApiException.notFound("That user has no credit account");
            default -> ApiException.unavailable("Credit service could not complete the request");
        };
    }

    private static String errorCode(RestClientResponseException exception) {
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

    private record ConflictRequest(String orderId, String reporterUserId, String comment, List<String> photos) {
    }

    private record SupplierResponse(Integer id, String name, double latitude, double longitude, String status) {
    }

    private record TelegramResponse(String userId, String telegramHandle) {
    }

    private record RatingResponse(String userId, Double average, Integer count) {
    }
}
