# syntax=docker/dockerfile:1

FROM ubuntu:22.04 AS build

ARG TELEGRAM_BOT_API_REF=master

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        g++ \
        git \
        gperf \
        libssl-dev \
        make \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${TELEGRAM_BOT_API_REF}" --recursive --shallow-submodules \
        https://github.com/tdlib/telegram-bot-api.git /src

WORKDIR /src/build
RUN cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX:PATH=/usr/local .. \
    && cmake --build . --target install -j"$(nproc)"

FROM ubuntu:22.04

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        libssl3 \
        libstdc++6 \
        zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /var/lib/telegram-bot-api botapi \
    && mkdir -p /var/lib/telegram-bot-api \
    && chown -R botapi:botapi /var/lib/telegram-bot-api

COPY --from=build /usr/local/bin/telegram-bot-api /usr/local/bin/telegram-bot-api

COPY docker/telegram-bot-api-entrypoint.sh /usr/local/bin/telegram-bot-api-entrypoint.sh
RUN chmod 0755 /usr/local/bin/telegram-bot-api-entrypoint.sh

USER botapi
EXPOSE 8081
VOLUME ["/var/lib/telegram-bot-api"]
ENTRYPOINT ["/usr/local/bin/telegram-bot-api-entrypoint.sh"]
