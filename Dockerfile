FROM node:18-alpine

# Install git and other dependencies
RUN apk add --no-cache git openssh-client bash curl

# Set working directory
WORKDIR /app

# Install global dependencies
RUN npm install -g nodemon

# Copy setup scripts
COPY scripts/setup.sh /app/scripts/setup.sh
COPY scripts/start-services.sh /app/scripts/start-services.sh
COPY scripts/sync-code.sh /app/scripts/sync-code.sh
COPY scripts/rebuild-preview.sh /app/scripts/rebuild-preview.sh

# Make scripts executable
RUN chmod +x /app/scripts/*.sh

# Install Monaco Editor dependencies
WORKDIR /app/editor
COPY editor/package.json editor/package-lock.json* ./
RUN npm install

# Copy editor code
COPY editor/ ./

# Expose ports for Monaco Editor and app preview
EXPOSE 3000 5000

# Set environment variables
ENV SOURCE_DIR=/source
ENV PREVIEW_DIR=/app/preview
ENV EDITOR_PORT=3000
ENV PREVIEW_PORT=5000

# Start services
CMD ["/app/scripts/start-services.sh"] 