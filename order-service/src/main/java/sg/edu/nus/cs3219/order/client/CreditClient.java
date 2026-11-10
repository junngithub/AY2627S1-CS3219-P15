/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service HTTP clients under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.client;

import java.util.UUID;

public interface CreditClient {

    void reserve(UUID orderId, String requesterId, int amount, UserAccount caller);

    void returnReserved(UUID orderId, UserAccount caller);
}
