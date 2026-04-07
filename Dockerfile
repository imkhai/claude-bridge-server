FROM node:20-slim

WORKDIR /app

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application code
COPY server.mjs ./
COPY src/ ./src/

# Create workspace directory and non-root user
RUN mkdir -p workspace && \
    addgroup --system appgroup && \
    adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 3210

CMD ["node", "server.mjs"]
