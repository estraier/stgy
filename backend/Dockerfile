FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json backend/
RUN npm ci --workspaces --include-workspace-root

COPY backend/tsconfig.json backend/
COPY backend/src backend/src
RUN npm run --workspace backend build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json backend/
RUN npm ci --omit=dev --workspaces --include-workspace-root

COPY --from=builder /app/backend/dist ./dist
