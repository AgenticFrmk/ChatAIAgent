# Build context: AgenticFrmk/ (one level above ChatAIAgent)
# docker-compose passes context: ../  and dockerfile: ChatAIAgent/Dockerfile

# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY ChatAIAgent/frontend/package.json ChatAIAgent/frontend/package-lock.json* ./
RUN npm ci --prefer-offline 2>/dev/null || npm install

COPY ChatAIAgent/frontend/ .
RUN npm run build

# ── Stage 2: nginx — static files + reverse proxy ────────────────────────────
FROM nginx:alpine

COPY --from=frontend-builder /build/dist /usr/share/nginx/html
COPY ChatAIAgent/nginx/nginx.conf.template /etc/nginx/nginx.conf.template

EXPOSE 80

# Substitute service URLs; nginx's own $host/$uri/etc. are left alone
CMD ["/bin/sh", "-c", \
  "envsubst '${ENVOY_URL} ${AUTH_SERVICE_URL} ${SLM_PLATFORM_URL} ${REGISTRY_SERVICE_URL} ${AGENT_CONTROL_PLANE_URL} ${SRE_AGENT_URL}' \
    < /etc/nginx/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf \
  && nginx -g 'daemon off;'"]
