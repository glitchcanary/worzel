# ---- build stage ----
FROM node:22-slim AS build

WORKDIR /app

# Install native-addon build tools (isolated-vm, opusscript)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
# scripts/bundle-vendor.js runs as part of `npm run build`
COPY scripts/ scripts/
RUN npm run build

# ---- production stage ----
FROM node:22-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy compiled output and web-client assets from build stage
COPY --from=build /app/dist/ dist/

# Fink client UI and story files needed at runtime
COPY fink/client/ fink/client/
# Vendor bundles made by the build stage (fink/client/dist/ is gitignored)
COPY --from=build /app/fink/client/dist/ fink/client/dist/
COPY stories/ stories/

# TTS cache and runtime temp directory
RUN mkdir -p tmp/tts-cache

ENV NODE_ENV=production
ENV WORZEL_HOST=0.0.0.0
ENV WORZEL_PORT=3000

EXPOSE 3000

CMD ["node", "dist/unified/index.js"]
