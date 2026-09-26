package sg.edu.nus.cs3219.order.rest;

import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.service.OrderCommandService;
import sg.edu.nus.cs3219.order.service.OrderQueryService;

import java.util.UUID;

@Tag(name = "Orders")
@RestController
public class OrderController {

    private final OrderCommandService commands;
    private final OrderQueryService queries;

    public OrderController(OrderCommandService commands, OrderQueryService queries) {
        this.commands = commands;
        this.queries = queries;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OrderResponse create(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @Valid @RequestBody CreateOrderRequest request
    ) {
        return OrderResponse.from(commands.create(authorization, request));
    }

    @GetMapping("/{orderId}")
    public OrderResponse get(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId
    ) {
        return OrderResponse.from(queries.get(authorization, orderId));
    }

    @PostMapping("/{orderId}/accept")
    public OrderResponse accept(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId
    ) {
        return OrderResponse.from(commands.accept(authorization, orderId));
    }

    @PostMapping("/{orderId}/cancel")
    public OrderResponse cancel(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId
    ) {
        return OrderResponse.from(commands.cancel(authorization, orderId));
    }

    @PostMapping(value = "/{orderId}/collect", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public OrderResponse collect(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId,
            @RequestParam("photo") MultipartFile photo
    ) {
        return OrderResponse.from(commands.collect(authorization, orderId, photo));
    }

    @PostMapping(value = "/{orderId}/deliver", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public OrderResponse deliver(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId,
            @RequestParam("photo") MultipartFile photo
    ) {
        return OrderResponse.from(commands.deliver(authorization, orderId, photo));
    }

    @PostMapping("/{orderId}/acknowledge")
    public OrderResponse acknowledge(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId
    ) {
        return OrderResponse.from(commands.acknowledge(authorization, orderId));
    }

    @PostMapping(value = "/{orderId}/escalate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public OrderResponse escalate(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId,
            @Valid @RequestBody EscalateRequest request
    ) {
        return OrderResponse.from(commands.escalate(authorization, orderId, request.disputeText(), null));
    }

    @PostMapping(value = "/{orderId}/escalate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public OrderResponse escalateWithPhoto(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @PathVariable UUID orderId,
            @RequestParam("disputeText") String disputeText,
            @RequestParam(value = "photo", required = false) MultipartFile photo
    ) {
        return OrderResponse.from(commands.escalate(authorization, orderId, disputeText, photo));
    }

    @GetMapping
    public PageResponse<OrderResponse> pool(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.pool(authorization, latitude, longitude, page, size).map(OrderResponse::from);
    }

    @GetMapping("/mine")
    public PageResponse<OrderResponse> mine(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.mine(authorization, page, size).map(OrderResponse::from);
    }

    @GetMapping("/search")
    public PageResponse<OrderResponse> search(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(required = false) String pickupLocationId,
            @RequestParam(required = false) String dropoffLocationId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.search(authorization, pickupLocationId, dropoffLocationId, page, size).map(OrderResponse::from);
    }
}
