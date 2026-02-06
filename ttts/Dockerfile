FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY ttts/package.json ttts/package.json
RUN npm ci --workspaces --include-workspace-root
COPY ttts ./ttts
RUN npm run build --workspace ttts
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/ttts/dist ./dist
COPY --from=builder /app/ttts/package.json ./ttts/package.json
RUN mkdir -p /app/data
ENV STGY_SEARCH_INDEX_DIR="/app/data"
ENV STGY_SEARCH_ENABLE_KUROMOJI=true
CMD ["node", "dist/index.js"]
