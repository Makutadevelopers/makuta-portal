FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/src ./src
COPY tsconfig.json ./

# tsx handles ESM imports without .js extensions
RUN npm install tsx

EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
