package sg.edu.nus.cs3219.order;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OrderServiceApplicationTest {

    @Test
    void applicationIsTheOrderService() {
        assertEquals("OrderServiceApplication", OrderServiceApplication.class.getSimpleName());
    }
}
