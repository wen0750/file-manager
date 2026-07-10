FROM node:20-slim

# Install system dependencies for sharp (image processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data/uploads

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/database.db
ENV UPLOAD_DIR=/app/data/uploads

# Expose port
EXPOSE 3000

# Volume for persistent data
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/auth/me', (r) => process.exit(r.statusCode < 500 ? 0 : 1))"

# Start the application
CMD ["node", "src/server.js"]
