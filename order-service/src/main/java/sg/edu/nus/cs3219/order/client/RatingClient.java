/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service HTTP clients under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.client;

public interface RatingClient {

    /**
     * Unified average for the user, or null when nobody has rated them yet.
     */
    Double ratingFor(String userId, UserAccount caller);
}
