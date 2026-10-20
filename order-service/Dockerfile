# Deployable Order Service image.
# Local-only tools (SonarQube) live in Dockerfile.local and are not part of this image.
FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libfreetype6 libpng16-16t64 \
    && rm -rf /var/lib/apt/lists/* \
    && dpkg --compare-versions "$(dpkg-query -W curl | cut -f2)" ge 8.18.0-1ubuntu2.8 \
    && dpkg --compare-versions "$(dpkg-query -W libcurl4t64 | cut -f2)" ge 8.18.0-1ubuntu2.8 \
    && dpkg --compare-versions "$(dpkg-query -W libfreetype6 | cut -f2)" ge 2.14.2+dfsg-1ubuntu0.2 \
    && dpkg --compare-versions "$(dpkg-query -W libpng16-16t64 | cut -f2)" ge 1.6.57-1ubuntu0.1
COPY --from=build /app/target/app.jar /app/app.jar
RUN groupadd --system app && useradd --system --gid app app \
    && mkdir -p /app/photos \
    && chown app:app /app/app.jar /app/photos \
    && rm -f /usr/bin/pebble
USER app
EXPOSE 8083
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["curl", "-fsS", "http://127.0.0.1:8083/actuator/health"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
