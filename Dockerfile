# Build the client, then run the API (Node 24: built-in SQLite and native TypeScript, no native deps).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY package.json ./
# The packet, byte-for-byte as delivered (its sha256 is recorded in every workspace).
COPY okafor_lindqvist_2025_packet.json ./
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/index.ts"]
