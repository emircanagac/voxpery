FROM rust:trixie AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
RUN mkdir -p src && echo "fn main() {}" > src/main.rs
RUN cargo build --release --locked

COPY migrations migrations
COPY build.rs build.rs
COPY src src
RUN cargo build --release --locked

FROM debian:trixie-slim AS runtime

# Apply Debian security updates at build time: the base image and the cached layer can
# otherwise ship packages (such as perl-base) that already have fixed versions.
# CI passes a new SECURITY_UPDATES_REFRESH value per build so this layer is never reused
# from the build cache.
ARG SECURITY_UPDATES_REFRESH=local
RUN echo "security updates refresh: ${SECURITY_UPDATES_REFRESH}" \
    && apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --uid 10001 voxpery
RUN mkdir -p /home/voxpery/attachments && chown -R voxpery:voxpery /home/voxpery

COPY --from=builder /app/target/release/voxpery-server /usr/local/bin/voxpery-server

USER voxpery
WORKDIR /home/voxpery

EXPOSE 3001

CMD ["voxpery-server"]
