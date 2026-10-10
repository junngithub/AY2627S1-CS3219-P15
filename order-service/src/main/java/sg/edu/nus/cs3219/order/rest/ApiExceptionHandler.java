package sg.edu.nus.cs3219.order.rest;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> handle(ApiException exception) {
        return ResponseEntity.status(exception.getStatus()).body(body(exception.getMessage(), exception.getCode()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleInvalid(MethodArgumentNotValidException exception) {
        String message = exception.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .orElse("The request is not valid");
        return ResponseEntity.badRequest().body(body(message, HttpStatus.BAD_REQUEST.name()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException exception) {
        return ResponseEntity.badRequest().body(body("The request body could not be read", HttpStatus.BAD_REQUEST.name()));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponse> handleMissingParam(MissingServletRequestParameterException exception) {
        return ResponseEntity.badRequest().body(body(exception.getParameterName() + " is required", HttpStatus.BAD_REQUEST.name()));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<ErrorResponse> handleMissingPart(MissingServletRequestPartException exception) {
        return ResponseEntity.badRequest().body(body(exception.getRequestPartName() + " is required", HttpStatus.BAD_REQUEST.name()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> handleTooLarge(MaxUploadSizeExceededException exception) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(body("Photos must be 10MB or smaller. Please retry with a smaller photo", HttpStatus.BAD_REQUEST.name()));
    }

    private static ErrorResponse body(String error, String code) {
        return new ErrorResponse(error, code);
    }
}
