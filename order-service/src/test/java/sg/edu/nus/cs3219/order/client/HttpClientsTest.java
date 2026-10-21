package sg.edu.nus.cs3219.order.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.rest.ApiException;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HttpClientsTest {

    private HttpServer server;
    private ExecutorService executor;
    private HttpClients clients;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastUser = new AtomicReference<>();
    private final AtomicReference<String> lastServiceToken = new AtomicReference<>();
    private final UserAccount ada = new UserAccount("ada-id");

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newCachedThreadPool(task -> {
            Thread thread = new Thread(task, "http-clients-test");
            thread.setDaemon(true);
            return thread;
        });
        server.setExecutor(executor);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            String requestBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            lastPath.set(path);
            lastBody.set(requestBody);
            byte[] empty = "null".getBytes(StandardCharsets.UTF_8);
            lastUser.set(exchange.getRequestHeaders().getFirst("X-User-Id"));
            lastServiceToken.set(exchange.getRequestHeaders().getFirst("X-Service-Token"));
            int status = 200;
            byte[] body = switch (path) {
                case "/api/v1/supplier/2" -> "{\"id\":2,\"name\":\"NUS Co-op\",\"latitude\":1.2,\"longitude\":103.7,\"status\":\"approved\",\"building\":\"COM2\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/supplier/3" -> "{\"id\":3,\"name\":\"Hidden\",\"latitude\":1.0,\"longitude\":103.0,\"status\":\"pending\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/supplier/empty" -> empty;
                case "/api/v1/supplier/missing" -> {
                    status = 404;
                    yield "{\"error\":\"Supplier not found\"}".getBytes(StandardCharsets.UTF_8);
                }
                case "/api/v1/supplier/slug" -> {
                    status = 400;
                    yield "{\"error\":\"Invalid supplier id\"}".getBytes(StandardCharsets.UTF_8);
                }
                case "/api/v1/supplier/down" -> {
                    status = 500;
                    yield "{\"error\":\"nope\"}".getBytes(StandardCharsets.UTF_8);
                }
                case "/api/v1/user/internal/users/11111111-1111-1111-1111-111111111111/telegram" ->
                        "{\"userId\":\"11111111-1111-1111-1111-111111111111\",\"telegramHandle\":\"ada_tan\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/user/internal/users/missing/telegram" -> {
                    status = 404;
                    yield "{\"error\":\"User not found\",\"code\":\"USER_NOT_FOUND\"}".getBytes(StandardCharsets.UTF_8);
                }
                case "/api/v1/user/internal/users/unverified/telegram" -> {
                    status = 409;
                    yield "{\"error\":\"User has not completed verification\",\"code\":\"USER_NOT_VERIFIED\"}".getBytes(StandardCharsets.UTF_8);
                }
                case "/api/v1/user/internal/users/blank/telegram" ->
                        "{\"userId\":\"blank\",\"telegramHandle\":\"\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/user/internal/users/down/telegram" -> {
                    status = 500;
                    yield "{\"error\":\"nope\",\"code\":\"INTERNAL_ERROR\"}".getBytes(StandardCharsets.UTF_8);
                }
                case "/api/v1/admin/conflicts" -> {
                    if (requestBody.contains("\"comment\":\"\"")) {
                        status = 422;
                        yield "{\"detail\":\"rejected\"}".getBytes(StandardCharsets.UTF_8);
                    }
                    if (requestBody.contains("admin-down")) {
                        status = 500;
                        yield "{\"detail\":\"nope\"}".getBytes(StandardCharsets.UTF_8);
                    }
                    status = 201;
                    yield "{\"id\":\"case-1\"}".getBytes(StandardCharsets.UTF_8);
                }
                default -> {
                    CreditProblem credit = creditProblem(requestBody);
                    if (credit == null) {
                        yield empty;
                    }
                    status = credit.status();
                    yield credit.body();
                }
            };
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        clients = clients("http://127.0.0.1:" + server.getAddress().getPort());
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
        executor.shutdownNow();
    }

    @Test
    void callsCredit() {
        UUID orderId = UUID.randomUUID();
        clients.reserve(orderId, "ada-id", 8, ada);
        assertEquals("ada-id", lastUser.get());
        assertTrue(lastBody.get().contains(orderId.toString()));
        assertTrue(lastBody.get().contains("requesterId"));
        clients.returnReserved(orderId, ada);
        assertEquals("/api/v1/credit/release", lastPath.get());
    }

    @Test
    void callsSupplier() {
        Place place = clients.requirePlace("2", ada);
        assertEquals("2", place.id());
        assertEquals("NUS Co-op", place.name());
        assertEquals(1.2, place.latitude());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ApiException.class, () -> clients.requirePlace("3", ada)).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ApiException.class, () -> clients.requirePlace("missing", ada)).getStatus());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ApiException.class, () -> clients.requirePlace("slug", ada)).getStatus());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ApiException.class, () -> clients.requirePlace("down", ada)).getStatus());
    }

    @Test
    void callsUserService() {
        assertEquals("ada_tan", clients.telegramHandle("11111111-1111-1111-1111-111111111111"));
        assertEquals("lookup-token", lastServiceToken.get());
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(ApiException.class, () -> clients.telegramHandle("missing")).getStatus());
        assertEquals(HttpStatus.CONFLICT, assertThrows(ApiException.class, () -> clients.telegramHandle("unverified")).getStatus());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ApiException.class, () -> clients.telegramHandle("blank")).getStatus());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ApiException.class, () -> clients.telegramHandle("down")).getStatus());
    }

    @Test
    void callsAdmin() {
        UUID orderId = UUID.randomUUID();
        clients.openConflict(orderId, "ada-id", "wrong item", java.util.List.of("a.png"));
        assertEquals("/api/v1/admin/conflicts", lastPath.get());
        assertTrue(lastBody.get().contains("\"orderId\":\"" + orderId + "\""));
        assertTrue(lastBody.get().contains("\"reporterUserId\":\"ada-id\""));
        assertTrue(lastBody.get().contains("\"comment\":\"wrong item\""));
        assertTrue(lastBody.get().contains("a.png"));
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ApiException.class,
                () -> clients.openConflict(orderId, "ada-id", "", java.util.List.of())).getStatus());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, assertThrows(ApiException.class,
                () -> clients.openConflict(orderId, "ada-id", "admin-down", java.util.List.of())).getStatus());
    }

    @Test
    void rejectsAnEmptySupplier() {
        assertThrows(ApiException.class, () -> clients.requirePlace("empty", ada));
    }

    @Test
    void mapsCreditFailures() {
        UUID orderId = UUID.randomUUID();
        ApiException broke = assertThrows(ApiException.class, () -> clients.reserve(orderId, "broke-user", 8, ada));
        assertEquals(HttpStatus.BAD_REQUEST, broke.getStatus());
        assertEquals("Not enough credits for this reward", broke.getMessage());

        ApiException invalid = assertThrows(ApiException.class, () -> clients.reserve(orderId, "bad-amount", 1, ada));
        assertEquals(HttpStatus.BAD_REQUEST, invalid.getStatus());

        UUID duplicate = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        ApiException reserved = assertThrows(ApiException.class, () -> clients.reserve(duplicate, "ada-id", 1, ada));
        assertEquals(HttpStatus.CONFLICT, reserved.getStatus());

        ApiException missingUser = assertThrows(ApiException.class, () -> clients.reserve(orderId, "missing-user", 1, ada));
        assertEquals(HttpStatus.NOT_FOUND, missingUser.getStatus());

        UUID released = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        ApiException missingOrder = assertThrows(ApiException.class, () -> clients.returnReserved(released, ada));
        assertEquals(HttpStatus.BAD_REQUEST, missingOrder.getStatus());
        assertEquals("No reserved credits were found for this order", missingOrder.getMessage());

        UUID unknown = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
        ApiException down = assertThrows(ApiException.class, () -> clients.reserve(unknown, "ada-id", 1, ada));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, down.getStatus());
    }

    @Test
    void reportsAnUnavailableService() {
        HttpClients down = clients("http://127.0.0.1:1");
        UUID orderId = UUID.randomUUID();
        assertThrows(ApiException.class, () -> down.reserve(orderId, "ada-id", 1, ada));
        assertThrows(ApiException.class, () -> down.returnReserved(orderId, ada));
        assertThrows(ApiException.class, () -> down.requirePlace("2", ada));
        assertThrows(ApiException.class, () -> down.telegramHandle("11111111-1111-1111-1111-111111111111"));
        assertThrows(ApiException.class, () -> down.openConflict(orderId, "ada-id", "wrong item", java.util.List.of()));
    }

    private static CreditProblem creditProblem(String body) {
        if (body.contains("broke-user")) {
            return new CreditProblem(409, "{\"code\":\"CREDIT_INSUFFICIENT_BALANCE\"}");
        }
        if (body.contains("bad-amount")) {
            return new CreditProblem(400, "{\"code\":\"CREDIT_INVALID_AMOUNT\"}");
        }
        if (body.contains("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")) {
            return new CreditProblem(409, "{\"code\":\"CREDIT_ORDER_ALREADY_RESERVED\"}");
        }
        if (body.contains("missing-user")) {
            return new CreditProblem(404, "{\"code\":\"CREDIT_USER_NOT_FOUND\"}");
        }
        if (body.contains("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")) {
            return new CreditProblem(404, "{\"code\":\"CREDIT_ORDER_NOT_FOUND\"}");
        }
        if (body.contains("cccccccc-cccc-cccc-cccc-cccccccccccc")) {
            return new CreditProblem(500, "{\"code\":\"CREDIT_UNKNOWN\"}");
        }
        return null;
    }

    private record CreditProblem(int status, String json) {
        private byte[] body() {
            return json.getBytes(StandardCharsets.UTF_8);
        }
    }

    private static HttpClients clients(String baseUrl) {
        OrderProperties properties = new OrderProperties();
        properties.getClients().setTimeout(java.time.Duration.ofSeconds(1));
        properties.getClients().setCreditBaseUrl(baseUrl);
        properties.getClients().setSupplierBaseUrl(baseUrl);
        properties.getClients().setRatingBaseUrl(baseUrl);
        properties.getClients().setAdminBaseUrl(baseUrl);
        properties.getClients().setUserBaseUrl(baseUrl);
        properties.getClients().setUserLookupToken("lookup-token");
        return new HttpClients(properties);
    }
}
