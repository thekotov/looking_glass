FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download || true

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /out/agent \
    ./cmd/agent

FROM debian:bookworm-slim

# Tools used by M3 task runners. Debian has hping3 in main repo (Alpine dropped it).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    iputils-ping \
    mtr-tiny \
    traceroute \
    hping3 \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/agent /usr/local/bin/agent

ENTRYPOINT ["/usr/local/bin/agent"]
