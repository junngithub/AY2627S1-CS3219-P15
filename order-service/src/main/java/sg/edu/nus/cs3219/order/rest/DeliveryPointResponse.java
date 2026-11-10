/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service REST layer under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.rest;

import sg.edu.nus.cs3219.order.persistence.DeliveryPointEntity;

import java.time.Instant;

public record DeliveryPointResponse(
        long id,
        String code,
        String name,
        String building,
        String description,
        double latitude,
        double longitude,
        String nickname,
        Integer useCount,
        Instant lastUsedAt
) {
    public static DeliveryPointResponse from(DeliveryPointEntity point) {
        return new DeliveryPointResponse(
                point.getId(),
                point.getCode(),
                point.getName(),
                point.getBuilding(),
                point.getDescription(),
                point.getLatitude(),
                point.getLongitude(),
                null,
                null,
                null
        );
    }

    public static DeliveryPointResponse from(
            DeliveryPointEntity point,
            String nickname,
            int useCount,
            Instant lastUsedAt
    ) {
        return new DeliveryPointResponse(
                point.getId(),
                point.getCode(),
                point.getName(),
                point.getBuilding(),
                point.getDescription(),
                point.getLatitude(),
                point.getLongitude(),
                nickname,
                useCount,
                lastUsedAt
        );
    }
}
