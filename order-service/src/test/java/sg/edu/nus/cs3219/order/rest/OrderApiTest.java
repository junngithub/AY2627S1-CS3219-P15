package sg.edu.nus.cs3219.order.rest;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.method.HandlerTypePredicate;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.config.OrderProperties;
import sg.edu.nus.cs3219.order.domain.OrderStatus;
import sg.edu.nus.cs3219.order.persistence.AlertEntity;
import sg.edu.nus.cs3219.order.persistence.OrderEntity;
import sg.edu.nus.cs3219.order.service.OrderCommandService;
import sg.edu.nus.cs3219.order.service.OrderQueryService;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class OrderApiTest {

    private final UUID id = UUID.fromString("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private final UserAccount caller = new UserAccount("requester-id", "requester@u.nus.edu", "requester");

    @Mock private OrderCommandService commands;
    @Mock private OrderQueryService queries;

    private MockMvc mvc;

    @BeforeEach
    void setUp() throws Exception {
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        OrderProperties properties = new OrderProperties();
        properties.getApi().setBasePath(String.valueOf(new YamlPropertySourceLoader()
                .load("application", new ClassPathResource("application.yml"))
                .get(0)
                .getProperty("order.api.base-path")));
        mapping.setPathPrefixes(Map.of(
                properties.getApi().getBasePath(),
                HandlerTypePredicate.forBasePackage("sg.edu.nus.cs3219.order.rest")));
        mvc = MockMvcBuilders.standaloneSetup(new OrderController(commands, queries), new AlertController(queries))
                .setCustomHandlerMapping(() -> mapping)
                .setCustomArgumentResolvers(new CallerArgumentResolver())
                .setControllerAdvice(new ApiExceptionHandler())
                .setValidator(validator)
                .build();
    }

    @Test
    void endpointsDelegateToTheServices() throws Exception {
        OrderEntity order = new OrderEntity();
        order.setId(id);
        order.setRequesterEmail("requester@u.nus.edu");
        order.setItemDescription("Print notes");
        order.setAmount(8);
        order.setStatus(OrderStatus.CREATED);
        order.setRequestTime(Instant.parse("2026-10-02T04:00:00Z"));
        order.setAcceptanceExpiry(Instant.parse("2026-10-02T05:00:00Z"));
        order.setDeliveryDeadline(Instant.parse("2026-10-02T06:00:00Z"));
        when(commands.create(eq(caller), any())).thenReturn(order);
        when(commands.accept(any(), eq(id))).thenReturn(order);
        when(commands.cancel(any(), eq(id))).thenReturn(order);
        when(commands.collect(any(), eq(id), any())).thenReturn(order);
        when(commands.deliver(any(), eq(id), any())).thenReturn(order);
        when(commands.acknowledge(any(), eq(id))).thenReturn(order);
        when(commands.escalate(any(), eq(id), eq("wrong item"), isNull())).thenReturn(order);
        when(commands.escalate(any(), eq(id), eq("wrong item"), any(org.springframework.web.multipart.MultipartFile.class))).thenReturn(order);
        when(queries.get(any(), eq(id))).thenReturn(order);
        when(queries.pool(any(), eq(1.2), eq(103.8), eq(0), eq(20))).thenReturn(PageResponse.of(List.of(order), 0, 20, 1));
        when(queries.mine(any(), eq(0), eq(20))).thenReturn(PageResponse.empty(0, 20));
        when(queries.search(any(), eq("nus-coop"), isNull(), eq(0), eq(20))).thenReturn(PageResponse.empty(0, 20, 0));
        AlertEntity alert = new AlertEntity();
        alert.setId(UUID.randomUUID());
        alert.setOrderId(id);
        alert.setFromStatus(null);
        alert.setToStatus("CREATED");
        alert.setCreatedAt(Instant.parse("2026-10-02T04:00:00Z"));
        when(queries.alerts(any(), anyInt(), anyInt())).thenReturn(PageResponse.of(List.of(alert), 0, 20, 1));

        mvc.perform(signed(post("/api/v1/orders"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"itemDescription":"Print notes","credits":8,"expiryTime":"2026-10-02T05:00:00Z","deliveryTime":"2026-10-02T06:00:00Z","fromLocation":"nus-coop","toLocation":"cool-spot"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("CREATED"));
        mvc.perform(signed(get("/api/v1/orders/" + id))).andExpect(status().isOk());
        mvc.perform(signed(post("/api/v1/orders/" + id + "/accept"))).andExpect(status().isOk());
        mvc.perform(signed(post("/api/v1/orders/" + id + "/cancel"))).andExpect(status().isOk());
        mvc.perform(signed(multipart("/api/v1/orders/" + id + "/collect").file(new MockMultipartFile("photo", "a.png", "image/png", new byte[]{1}))))
                .andExpect(status().isOk());
        mvc.perform(signed(multipart("/api/v1/orders/" + id + "/deliver").file(new MockMultipartFile("photo", "a.png", "image/png", new byte[]{1}))))
                .andExpect(status().isOk());
        mvc.perform(signed(post("/api/v1/orders/" + id + "/acknowledge"))).andExpect(status().isOk());
        mvc.perform(signed(post("/api/v1/orders/" + id + "/escalate").contentType(MediaType.APPLICATION_JSON).content("{\"disputeText\":\"wrong item\"}")))
                .andExpect(status().isOk());
        mvc.perform(signed(multipart("/api/v1/orders/" + id + "/escalate")
                        .file(new MockMultipartFile("photo", "a.png", "image/png", new byte[]{1}))
                        .param("disputeText", "wrong item")))
                .andExpect(status().isOk());
        mvc.perform(signed(get("/api/v1/orders").param("latitude", "1.2").param("longitude", "103.8"))).andExpect(status().isOk());
        mvc.perform(signed(get("/api/v1/orders/mine"))).andExpect(status().isOk());
        mvc.perform(signed(get("/api/v1/orders/search").param("pickupLocationId", "nus-coop"))).andExpect(status().isOk());
        mvc.perform(signed(get("/api/v1/orders/alerts"))).andExpect(jsonPath("$.content[0].toStatus").value("CREATED"));
    }

    @Test
    void invalidRequestsBecomeReadableErrors() throws Exception {
        mvc.perform(post("/api/v1/orders").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Sign in is required"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(signed(post("/api/v1/orders")).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
        mvc.perform(signed(post("/api/v1/orders")).contentType(MediaType.APPLICATION_JSON).content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("The request body could not be read"))
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));
        mvc.perform(signed(multipart("/api/v1/orders/" + id + "/collect")))
                .andExpect(status().isBadRequest());

        ApiExceptionHandler handler = new ApiExceptionHandler();
        org.junit.jupiter.api.Assertions.assertEquals(400, handler.handleTooLarge(new MaxUploadSizeExceededException(10)).getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals("BAD_REQUEST", handler.handleTooLarge(new MaxUploadSizeExceededException(10)).getBody().code());
        org.junit.jupiter.api.Assertions.assertEquals(400, handler.handleMissingParam(new org.springframework.web.bind.MissingServletRequestParameterException("photo", "MultipartFile")).getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals(409, handler.handle(ApiException.conflict("taken")).getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals("CONFLICT", handler.handle(ApiException.conflict("taken")).getBody().code());
        org.junit.jupiter.api.Assertions.assertEquals(401, handler.handle(ApiException.unauthorized("sign in")).getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals("UNAUTHORIZED", handler.handle(ApiException.unauthorized("sign in")).getBody().code());
        org.junit.jupiter.api.Assertions.assertEquals(404, handler.handle(ApiException.notFound("missing")).getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals("NOT_FOUND", handler.handle(ApiException.notFound("missing")).getBody().code());
        org.junit.jupiter.api.Assertions.assertEquals(503, handler.handle(ApiException.unavailable("down")).getStatusCode().value());
        org.junit.jupiter.api.Assertions.assertEquals("SERVICE_UNAVAILABLE", handler.handle(ApiException.unavailable("down")).getBody().code());
    }

    private <B extends AbstractMockHttpServletRequestBuilder<B>> B signed(B request) {
        return request
                .header(CallerHeaders.USER_ID, caller.userId())
                .header(CallerHeaders.EMAIL, caller.email())
                .header(CallerHeaders.TELEGRAM, caller.telegramHandle());
    }
}
