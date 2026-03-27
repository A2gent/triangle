# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/backend/package.json ./packages/backend/package.json

RUN npm ci

COPY packages/backend ./packages/backend
RUN npm --workspace @triangle/backend run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/package.json
RUN npm ci --omit=dev --workspace @triangle/backend

COPY --from=builder /app/packages/backend/dist ./packages/backend/dist

EXPOSE 9080
CMD ["node", "packages/backend/dist/server.js"]
