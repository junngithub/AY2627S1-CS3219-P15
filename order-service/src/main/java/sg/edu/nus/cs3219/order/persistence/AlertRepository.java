package sg.edu.nus.cs3219.order.persistence;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AlertRepository extends JpaRepository<AlertEntity, UUID> {

    Page<AlertEntity> findByRequesterEmailAndNotifyRequesterTrueOrderByCreatedAtDesc(
            String requesterEmail,
            Pageable pageable
    );
}
