package sg.edu.nus.cs3219.order.client;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
            lastPath.set(exchange.getRequestURI().getPath());
            lastBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] empty = "null".getBytes(StandardCharsets.UTF_8);
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            byte[] body = switch (exchange.getRequestURI().getPath()) {
                case "/api/v1/user/authorize" -> "Bearer empty".equals(authorization)
                        ? "{\"authenticated\":false}".getBytes(StandardCharsets.UTF_8)
                        : "{\"authenticated\":true,\"userId\":\"ada-id\",\"isAdmin\":false}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/user/me" -> "Bearer nameless".equals(authorization)
                        ? "{\"email\":\"ada@u.nus.edu\"}".getBytes(StandardCharsets.UTF_8)
                        : "{\"email\":\"ada@u.nus.edu\",\"name\":\"Ada\",\"telegramHandle\":\"ada\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/supplier/nus-coop" -> "{\"id\":\"nus-coop\",\"name\":\"NUS Co-op\",\"latitude\":1.2,\"longitude\":103.7,\"building\":\"COM2\"}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/supplier/empty" -> empty;
                case "/api/v1/rating/ada-id" -> "{\"average\":4.25,\"count\":3}".getBytes(StandardCharsets.UTF_8);
                case "/api/v1/rating/missing" -> empty;
                default -> empty;
            };
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
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
    void callsTheOtherServices() {
        UserAccount account = clients.authenticate("Bearer token");
        assertEquals("ada-id", account.userId());
        assertEquals("ada@u.nus.edu", account.email());
        assertEquals("ada", account.telegramHandle());
        assertEquals("ada", clients.authenticate("Bearer nameless").telegramHandle());

        UUID orderId = UUID.randomUUID();
        clients.reserve(orderId, "ada-id", 8, "Bearer token");
        assertTrue(lastBody.get().contains(orderId.toString()));
        assertTrue(lastBody.get().contains("requesterId"));
        clients.returnReserved(orderId, "Bearer token");
        assertEquals("/api/v1/credit/release", lastPath.get());

        Place place = clients.requirePlace("nus-coop", "Bearer token");
        assertEquals("NUS Co-op", place.name());
        assertEquals(1.2, place.latitude());
        assertEquals(4.25, clients.ratingFor("ada-id", "Bearer token"));
        clients.escalate(new OrderContext(orderId, "COLLECTED", "Print notes", 8,
                "ada@u.nus.edu", "ada", 5.0, "courier@u.nus.edu", "courier", 4.0,
                null, null, null, null, null, "nus-coop", "NUS Co-op", 1.2, 103.7,
                "cool-spot", "Cool Spot", 1.3, 103.8, "collection", "delivery", "dispute", "wrong item"), "Bearer token");
        assertTrue(lastBody.get().contains(orderId.toString()));
        assertTrue(lastBody.get().contains("Print notes"));
        assertTrue(lastBody.get().contains("collection"));
        assertEquals("/escalations", lastPath.get());
    }

    @Test
    void rejectsAMissingSignInAndAnEmptyAccount() {
        assertThrows(ApiException.class, () -> clients.authenticate(" "));
        assertThrows(ApiException.class, () -> clients.authenticate("Bearer empty"));
        assertThrows(ApiException.class, () -> clients.requirePlace("empty", "Bearer token"));
        assertThrows(ApiException.class, () -> clients.ratingFor("missing", "Bearer token"));
    }

    @Test
    void reportsAnUnavailableService() {
        HttpClients down = clients("http://127.0.0.1:1");
        UUID orderId = UUID.randomUUID();
        assertThrows(ApiException.class, () -> down.authenticate("Bearer token"));
        assertThrows(ApiException.class, () -> down.reserve(orderId, "ada-id", 1, "Bearer token"));
        assertThrows(ApiException.class, () -> down.returnReserved(orderId, "Bearer token"));
        assertThrows(ApiException.class, () -> down.requirePlace("nus-coop", "Bearer token"));
        assertThrows(ApiException.class, () -> down.ratingFor("ada-id", "Bearer token"));
        assertThrows(ApiException.class, () -> down.escalate(new OrderContext(orderId, null, null, 1,
                null, null, null, null, null, null, null, null, null, null, null,
                null, null, 0, 0, null, null, 0, 0, null, null, null, "text"), "Bearer token"));
    }

    private static HttpClients clients(String baseUrl) {
        OrderProperties properties = new OrderProperties();
        properties.getClients().setTimeout(java.time.Duration.ofSeconds(1));
        properties.getClients().setUserBaseUrl(baseUrl);
        properties.getClients().setCreditBaseUrl(baseUrl);
        properties.getClients().setSupplierBaseUrl(baseUrl);
        properties.getClients().setRatingBaseUrl(baseUrl);
        properties.getClients().setAdminBaseUrl(baseUrl);
        return new HttpClients(properties);
    }
}
