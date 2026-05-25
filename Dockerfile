# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests and lockfile
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy the rest of the code files
COPY . .

# Build the Vite client and bundle the Express server
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built distribution files from builder stage
COPY --from=builder /app/dist ./dist

# Expose port (Cloud Run automatically redirects requests to this port)
EXPOSE 3000

# Run the bundled server script
CMD ["npm", "start"]
