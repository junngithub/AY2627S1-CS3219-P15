package sg.edu.nus.cs3219.order.persistence;

import org.springframework.data.repository.Repository;

import java.util.UUID;

public interface OrderLogRepository extends Repository<OrderLogEntity, UUID> {

    OrderLogEntity save(OrderLogEntity entry);
}
