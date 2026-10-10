package sg.edu.nus.cs3219.order.photo;

import org.springframework.web.multipart.MultipartFile;
import sg.edu.nus.cs3219.order.rest.ApiException;

final class PhotoRules {

    private PhotoRules() {
    }

    static void requirePresent(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("A photo is required before this status can change");
        }
    }

    static String extensionFor(String contentType) {
        if (contentType == null) {
            throw ApiException.badRequest("Upload a JPEG, PNG, or WebP photo");
        }
        return switch (contentType) {
            case "image/jpeg" -> "jpg";
            case "image/png" -> "png";
            case "image/webp" -> "webp";
            default -> throw ApiException.badRequest("Upload a JPEG, PNG, or WebP photo");
        };
    }
}
