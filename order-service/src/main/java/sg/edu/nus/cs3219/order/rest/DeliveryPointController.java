/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service REST layer under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.rest;

import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import sg.edu.nus.cs3219.order.client.UserAccount;
import sg.edu.nus.cs3219.order.service.DeliveryPointService;

@Tag(name = "Delivery points")
@RestController
@RequestMapping("/delivery-points")
public class DeliveryPointController {

    private final DeliveryPointService deliveryPoints;

    public DeliveryPointController(DeliveryPointService deliveryPoints) {
        this.deliveryPoints = deliveryPoints;
    }

    @GetMapping
    public PageResponse<DeliveryPointResponse> catalogue(
            UserAccount caller,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return deliveryPoints.catalogue(page, size);
    }

    @GetMapping("/my-locations")
    public PageResponse<DeliveryPointResponse> myLocations(
            UserAccount caller,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return deliveryPoints.myLocations(caller, page, size);
    }

    @PatchMapping("/{id}")
    public DeliveryPointResponse update(
            UserAccount caller,
            @PathVariable long id,
            @Valid @RequestBody UpdateDeliveryPointRequest request
    ) {
        return deliveryPoints.update(caller, id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(UserAccount caller, @PathVariable long id) {
        deliveryPoints.delete(caller, id);
    }
}
