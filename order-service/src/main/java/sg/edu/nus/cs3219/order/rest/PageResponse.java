package sg.edu.nus.cs3219.order.rest;

import java.util.List;

public record PageResponse<T>(List<T> content, int page, int size, long totalElements) {

    public static <T> PageResponse<T> empty(int page, int size) {
        return new PageResponse<>(List.of(), page, size, 0);
    }

    public static <T> PageResponse<T> empty(int page, int size, long totalElements) {
        return new PageResponse<>(List.of(), page, size, totalElements);
    }

    public static <T> PageResponse<T> of(List<T> content, int page, int size, long totalElements) {
        return new PageResponse<>(content, page, size, totalElements);
    }

    public <R> PageResponse<R> map(java.util.function.Function<T, R> mapper) {
        return new PageResponse<>(content.stream().map(mapper).toList(), page, size, totalElements);
    }
}
