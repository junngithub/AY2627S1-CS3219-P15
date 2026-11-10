/**
 * AI Assistance Disclosure
 * Tool: Cursor (Auto), date: 2026-10-15
 * Scope: Implementation assistance for Order Service messaging/outbox under author-fixed requirements and architecture.
 * Author review: Varun Sivakumar generated ideas, designed implementation, validated correctness, edited where needed, and verified behavior/tests.
 */

package sg.edu.nus.cs3219.order.messaging;

public final class KafkaTopics {

    public static final String CREDIT = "foc.credit.commands";
    public static final String RATING = "foc.rating.commands";
    public static final String ADMIN_COMMANDS = "foc.admin.commands";
    public static final String ORDER_STATUS = "foc.order.status";
    public static final String ADMIN_EVENTS = "foc.admin.events";
    public static final String USER_STATUS = "foc.user.status";

    private KafkaTopics() {
    }
}
