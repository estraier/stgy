FROM golang:1.24.5-alpine AS builder

RUN apk add --no-cache ca-certificates git \
    && mkdir -p /out

ARG MINIO_RELEASE=RELEASE.2025-07-23T15-54-02Z
ARG MINIO_COMMIT=7ced9663e6a791fef9dc6be798ff24cda9c730ac
ARG MC_RELEASE=RELEASE.2025-07-21T05-28-08Z
ARG MC_COMMIT_SHORT=ee72571

RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git /src/minio \
    && test "$(git -C /src/minio rev-parse HEAD)" = "${MINIO_COMMIT}"

WORKDIR /src/minio
RUN ldflags="$(go run buildscripts/gen-ldflags.go)" \
    && CGO_ENABLED=0 go build \
      -tags kqueue \
      -trimpath \
      --ldflags "${ldflags}" \
      -o /out/minio .

RUN git clone --depth 1 --branch "${MC_RELEASE}" https://github.com/minio/mc.git /src/mc \
    && test "$(git -C /src/mc rev-parse --short=7 HEAD)" = "${MC_COMMIT_SHORT}"

WORKDIR /src/mc
RUN ldflags="$(go run buildscripts/gen-ldflags.go)" \
    && CGO_ENABLED=0 go build \
      -tags kqueue \
      -trimpath \
      --ldflags "${ldflags}" \
      -o /out/mc .

FROM alpine:3.22

RUN apk add --no-cache ca-certificates curl

COPY --from=builder /out/minio /usr/bin/minio
COPY --from=builder /out/mc /usr/bin/mc
COPY --from=builder /src/minio/LICENSE /licenses/minio/LICENSE
COPY --from=builder /src/minio/CREDITS /licenses/minio/CREDITS
COPY --from=builder /src/mc/LICENSE /licenses/mc/LICENSE
COPY --from=builder /src/mc/CREDITS /licenses/mc/CREDITS

EXPOSE 9000 9001
VOLUME ["/data"]

CMD ["minio"]
