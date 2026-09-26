package sg.edu.nus.cs3219.order.messaging;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import sg.edu.nus.cs3219.order.config.OrderProperties;

@Configuration
public class KafkaTopicConfig {

    @Bean
    NewTopic creditTopic(OrderProperties properties) {
        return topic(KafkaTopics.CREDIT, properties);
    }

    @Bean
    NewTopic ratingTopic(OrderProperties properties) {
        return topic(KafkaTopics.RATING, properties);
    }

    @Bean
    NewTopic adminCommandTopic(OrderProperties properties) {
        return topic(KafkaTopics.ADMIN_COMMANDS, properties);
    }

    @Bean
    NewTopic orderStatusTopic(OrderProperties properties) {
        return topic(KafkaTopics.ORDER_STATUS, properties);
    }

    @Bean
    NewTopic adminEventTopic(OrderProperties properties) {
        return topic(KafkaTopics.ADMIN_EVENTS, properties);
    }

    private static NewTopic topic(String name, OrderProperties properties) {
        return TopicBuilder.name(name)
                .partitions(properties.getKafka().getPartitions())
                .replicas(properties.getKafka().getReplicas())
                .build();
    }
}
