#!/bin/bash
set -e

# Run setup script
echo "Running setup script..."
/app/scripts/setup.sh

# Start Monaco Editor
echo "Starting Monaco Editor on port $EDITOR_PORT..."
cd /app/editor
nohup npm start > /app/editor.log 2>&1 &

# Wait for editor to start
echo "Waiting for editor to start..."
timeout=30
while [ $timeout -gt 0 ]; do
    if curl -s http://localhost:$EDITOR_PORT > /dev/null; then
        echo "Editor started successfully"
        break
    fi
    sleep 1
    ((timeout--))
done

if [ $timeout -eq 0 ]; then
    echo "Warning: Editor failed to start within the timeout period"
fi

# Start application preview
echo "Starting application preview on port $PREVIEW_PORT..."
cd $PREVIEW_DIR

# Check if the project has a specific start script
if grep -q "\"start\":" package.json 2>/dev/null; then
    # Use PORT environment variable for the preview
    export PORT=$PREVIEW_PORT
    
    # Start with nodemon to enable auto-restart on file changes
    nodemon --watch . --ignore node_modules/ --exec "npm start" > /app/preview.log 2>&1 &
else
    echo "No start script found in package.json, using a simple server..."
    # Install a simple server if needed
    npm install -g serve
    # Start a simple server
    serve -s . -l $PREVIEW_PORT > /app/preview.log 2>&1 &
fi

# Start sync service if auto sync is enabled
if [ "$AUTO_SYNC" = "true" ]; then
    echo "Starting auto-sync service..."
    /app/scripts/sync-code.sh &
fi

# Keep container running
echo "All services started. Container is now running."
tail -f /app/editor.log /app/preview.log 