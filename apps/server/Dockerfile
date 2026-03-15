FROM rust:bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
COPY migrations migrations
COPY src src

RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --uid 10001 voxpery

COPY --from=builder /app/target/release/voxpery-server /usr/local/bin/voxpery-server

USER voxpery
WORKDIR /home/voxpery

EXPOSE 3001

CMD ["voxpery-server"]
