FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/package.json
COPY packages/markdown/package.json packages/markdown/package.json
RUN npm config set registry https://registry.npmjs.org/
RUN npm ci --workspaces --include-workspace-root
COPY backend ./backend
COPY packages/markdown ./packages/markdown
RUN npm run packages:build && npm run backend:build
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/src/prompts ./dist/prompts
COPY --from=builder /app/backend/package.json ./backend/package.json
