/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service REST layer under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.rest;

import jakarta.validation.constraints.Size;

public record UpdateDeliveryPointRequest(
        @Size(max = 200) String name,
        @Size(max = 200) String building,
        @Size(max = 500) String description,
        Double latitude,
        Double longitude,
        @Size(max = 80) String nickname
) {
}
