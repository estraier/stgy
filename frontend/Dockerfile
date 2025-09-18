FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/package.json
COPY packages/markdown/package.json packages/markdown/package.json
RUN npm config set registry https://registry.npmjs.org/
RUN npm ci --workspaces --include-workspace-root
COPY frontend ./frontend
COPY packages/markdown ./packages/markdown
ARG NEXT_PUBLIC_BACKEND_API_BASE_URL
ARG NEXT_PUBLIC_STORAGE_S3_BUCKET_PREFIX
ARG NEXT_PUBLIC_STORAGE_S3_PUBLIC_URL_PREFIX
ENV NEXT_PUBLIC_BACKEND_API_BASE_URL=${NEXT_PUBLIC_BACKEND_API_BASE_URL}
ENV NEXT_PUBLIC_STORAGE_S3_BUCKET_PREFIX=${NEXT_PUBLIC_STORAGE_S3_BUCKET_PREFIX}
ENV NEXT_PUBLIC_STORAGE_S3_PUBLIC_URL_PREFIX=${NEXT_PUBLIC_STORAGE_S3_PUBLIC_URL_PREFIX}
RUN npm run packages:build && npm run frontend:build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public
