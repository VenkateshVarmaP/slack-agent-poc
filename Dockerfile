# Stage 1: Build TypeScript to JavaScript
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production Runtime (Always-On Socket Mode for EC2 / ECS / App Runner)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install -g mcp-remote@0.1.36

COPY --from=builder /app/dist ./dist
COPY docs ./docs

CMD ["node", "dist/index.js"]
