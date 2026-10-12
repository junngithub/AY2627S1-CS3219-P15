package sg.edu.nus.cs3219.order.rest;

import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.client.UserAccount;
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
    public OrderResponse create(UserAccount caller, @Valid @RequestBody CreateOrderRequest request) {
        return OrderResponse.from(commands.create(caller, request));
    }

    @GetMapping("/{orderId}")
    public OrderResponse get(UserAccount caller, @PathVariable UUID orderId) {
        return OrderResponse.from(queries.get(caller, orderId));
    }

    @PostMapping("/{orderId}/accept")
    public OrderResponse accept(UserAccount caller, @PathVariable UUID orderId) {
        return OrderResponse.from(commands.accept(caller, orderId));
    }

    @PostMapping("/{orderId}/cancel")
    public OrderResponse cancel(UserAccount caller, @PathVariable UUID orderId) {
        return OrderResponse.from(commands.cancel(caller, orderId));
    }

    @PostMapping(value = "/{orderId}/collect", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public OrderResponse collect(UserAccount caller, @PathVariable UUID orderId, @RequestParam("photo") MultipartFile photo) {
        return OrderResponse.from(commands.collect(caller, orderId, photo));
    }

    @PostMapping(value = "/{orderId}/deliver", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public OrderResponse deliver(UserAccount caller, @PathVariable UUID orderId, @RequestParam("photo") MultipartFile photo) {
        return OrderResponse.from(commands.deliver(caller, orderId, photo));
    }

    @PostMapping("/{orderId}/acknowledge")
    public OrderResponse acknowledge(UserAccount caller, @PathVariable UUID orderId) {
        return OrderResponse.from(commands.acknowledge(caller, orderId));
    }

    @PostMapping(value = "/{orderId}/escalate", consumes = MediaType.APPLICATION_JSON_VALUE)
    public OrderResponse escalate(UserAccount caller, @PathVariable UUID orderId, @Valid @RequestBody EscalateRequest request) {
        return OrderResponse.from(commands.escalate(caller, orderId, request.disputeText(), null));
    }

    @PostMapping(value = "/{orderId}/escalate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public OrderResponse escalateWithPhoto(
            UserAccount caller,
            @PathVariable UUID orderId,
            @RequestParam("disputeText") String disputeText,
            @RequestParam(value = "photo", required = false) MultipartFile photo
    ) {
        return OrderResponse.from(commands.escalate(caller, orderId, disputeText, photo));
    }

    @GetMapping
    public PageResponse<OrderResponse> pool(
            UserAccount caller,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.pool(caller, latitude, longitude, page, size).map(OrderResponse::from);
    }

    @GetMapping("/mine")
    public PageResponse<OrderResponse> mine(
            UserAccount caller,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.mine(caller, page, size).map(OrderResponse::from);
    }

    @GetMapping("/search")
    public PageResponse<OrderResponse> search(
            UserAccount caller,
            @RequestParam(required = false) String pickupLocationId,
            @RequestParam(required = false) String dropoffLocationId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.search(caller, pickupLocationId, dropoffLocationId, page, size).map(OrderResponse::from);
    }
}
