FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json frontend/
RUN npm ci --workspaces --include-workspace-root

COPY frontend ./frontend
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
RUN npm run --workspace frontend build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public
