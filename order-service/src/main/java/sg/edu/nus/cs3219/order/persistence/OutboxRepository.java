package sg.edu.nus.cs3219.order.persistence;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface OutboxRepository extends JpaRepository<OutboxEntity, UUID> {

    List<OutboxEntity> findTop50ByPublishedAtIsNullOrderByCreatedAtAsc();
}
