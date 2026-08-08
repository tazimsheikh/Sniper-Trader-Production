# ── STAGE 1: Builder (Compiles the app and native modules) ───────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install heavy build dependencies for native modules (e.g., canvas, sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev

# Copy package manifests
COPY package*.json ./

# Configure npm to be resilient against node-gyp header download TLS timeouts
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

# Install ALL dependencies (including devDependencies needed for Vite/Esbuild)
# We use loglevel=error to silence all the annoying 'deprecated' warnings
RUN npm ci --loglevel=error --no-fund --no-audit

# Copy the entire source tree
COPY . .

# Build the Vite client and bundle the Express server into dist/
RUN npm run build

# Strip out all devDependencies (Vite, React, etc.) to leave only production deps
# This keeps the pre-compiled native canvas module intact!
RUN npm prune --omit=dev


# ── STAGE 2: Runner (Pristine, ultra-lightweight production image) ───────────
FROM node:22-bookworm-slim

WORKDIR /app

# Set timezone to Eastern Time
ENV TZ=America/New_York
ENV NODE_ENV=production

# Install ONLY the runtime libraries required by native modules (no -dev headers)
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

# Copy the pruned node_modules (which contains the pre-compiled canvas binary)
COPY --from=builder /app/node_modules ./node_modules

# Copy only the compiled output from the builder stage
COPY --from=builder /app/dist ./dist

# Note: If your production backend reads from `data/` directly during runtime, copy it over.
COPY data/ ./data/

# Expose port (Cloud Run/GCP automatically redirects requests to this port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Start the bundled Node.js server directly
CMD ["node", "dist/server.mjs"]
