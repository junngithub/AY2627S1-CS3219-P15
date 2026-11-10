/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service REST layer under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

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
        Long deliveryPointId,
        @Size(max = 200) String dropoffName,
        @Size(max = 200) String dropoffBuilding,
        @Size(max = 500) String dropoffDescription,
        Double dropoffLat,
        Double dropoffLng
) {
}
