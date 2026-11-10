/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service HTTP clients under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.client;

import java.util.List;
import java.util.UUID;

public interface AdminClient {

    void openConflict(UUID orderId, String reporterUserId, String comment, List<String> photos);
}
