FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=http://localhost:3001
ARG TURNSTILE_SITE_KEY_PUBLIC=

RUN VITE_API_URL="${VITE_API_URL}" \
    VITE_TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY_PUBLIC}" \
    npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
