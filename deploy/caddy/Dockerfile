# Caddy with the DuckDNS DNS provider, needed only for the wildcard certificate of isolated preview
# hosts (*.QAAP_PREVIEW_BASE_DOMAIN, see previews/duckdns.caddy). Wildcards require the ACME DNS-01
# challenge; the stock image has no DNS providers.
ARG CADDY_VERSION=2
FROM caddy:${CADDY_VERSION}-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:${CADDY_VERSION}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
