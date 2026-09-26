# Deployable Order Service image.
# Local-only tools (SonarQube) live in Dockerfile.local and are not part of this image.
FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/app.jar /app/app.jar
RUN groupadd --system app && useradd --system --gid app app \
    && mkdir -p /app/photos \
    && chown app:app /app/app.jar /app/photos
USER app
EXPOSE 8083
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
