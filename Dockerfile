# AUN Payroll — production image (API + built web app on one origin).
# Build:  docker build --build-arg BASE_PATH=/payrol -t aun-payroll .
# Run:    docker run --env-file backend/.env.production -p 5000:5000 aun-payroll
# Put an HTTPS reverse proxy (or the host's TLS) in front of port 5000.

# ---- 1) build the React app ------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Sub-path the app is published under (e.g. /payrol); must match BASE_PATH at runtime.
ARG BASE_PATH=
RUN npm run build

# ---- 2) runtime -------------------------------------------------------------
FROM node:22-bookworm-slim
# System Chromium for PDF rendering (+ fonts so payslips render correctly)
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=5000 \
    SERVE_FRONTEND=true \
    FRONTEND_DIST=/app/frontend/dist

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN mkdir -p logs && chown -R node:node /app/backend/logs

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+(process.env.BASE_PATH||'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
