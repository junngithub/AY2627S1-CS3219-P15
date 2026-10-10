package sg.edu.nus.cs3219.order.rest;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record CreateOrderRequest(
        @NotBlank @Size(max = 500) String itemDescription,
        @Min(1) int credits,
        @NotNull Instant expiryTime,
        @NotNull Instant deliveryTime,
        @NotBlank String fromLocation,
        @NotBlank String toLocation
) {
}
