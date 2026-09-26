package sg.edu.nus.cs3219.order.rest;

import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import sg.edu.nus.cs3219.order.service.OrderQueryService;

@Tag(name = "Alerts")
@RestController
@RequestMapping("/alerts")
public class AlertController {

    private final OrderQueryService queries;

    public AlertController(OrderQueryService queries) {
        this.queries = queries;
    }

    @GetMapping
    public PageResponse<AlertResponse> alerts(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return queries.alerts(authorization, page, size).map(AlertResponse::from);
    }
}
