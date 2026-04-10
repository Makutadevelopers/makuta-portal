FROM node:22-alpine
WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src

EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
