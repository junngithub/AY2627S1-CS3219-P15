/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service domain (state machine / ranking) under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.domain;

public record PreparedDropoff(
        Long existingId,
        String name,
        String building,
        String description,
        double latitude,
        double longitude
) {
    public boolean isExisting() {
        return existingId != null;
    }
}
