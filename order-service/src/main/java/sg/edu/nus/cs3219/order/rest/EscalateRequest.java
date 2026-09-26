package sg.edu.nus.cs3219.order.rest;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record EscalateRequest(@NotBlank @Size(max = 2000) String disputeText) {
}
