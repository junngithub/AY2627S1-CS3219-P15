/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service photo storage under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.photo;

import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

public interface PhotoStore {

    String store(UUID orderId, String role, MultipartFile file);

    void delete(String reference);
}
