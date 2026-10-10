package sg.edu.nus.cs3219.order.messaging;

public final class KafkaTopics {

    public static final String CREDIT = "foc.credit.commands";
    public static final String RATING = "foc.rating.commands";
    public static final String ADMIN_COMMANDS = "foc.admin.commands";
    public static final String ORDER_STATUS = "foc.order.status";
    public static final String ADMIN_EVENTS = "foc.admin.events";

    private KafkaTopics() {
    }
}
