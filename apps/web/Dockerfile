FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=http://localhost:3001
ARG TURNSTILE_SITE_KEY_PUBLIC=
ARG VITE_APP_VERSION=
ARG VITE_GIPHY_API_KEY=

RUN VITE_API_URL="${VITE_API_URL}" \
    VITE_TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY_PUBLIC}" \
    VITE_APP_VERSION="${VITE_APP_VERSION}" \
    VITE_GIPHY_API_KEY="${VITE_GIPHY_API_KEY}" \
    npm run build

# nginx stable branch; the minor tag picks up patch releases and Alpine rebuilds.
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime

# Apply Alpine security updates at build time (see apps/server/Dockerfile). CI passes a new
# SECURITY_UPDATES_REFRESH value per build so this layer is never reused from the build cache.
ARG SECURITY_UPDATES_REFRESH=local
USER root
RUN echo "security updates refresh: ${SECURITY_UPDATES_REFRESH}" \
    && apk upgrade --no-cache
USER 101

ARG APP_ENV=development
COPY nginx.${APP_ENV}.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
