#!/bin/bash
set -e

echo "Rebuilding application preview..."

cd $PREVIEW_DIR

# Check if the project has a build script
if grep -q "\"build\":" package.json 2>/dev/null; then
    echo "Running build script..."
    npm run build
    
    # Check if build succeeded
    if [ $? -eq 0 ]; then
        echo "Build completed successfully"
    else
        echo "Build failed"
        exit 1
    fi
else
    echo "No build script found in package.json"
fi

# Find the preview process and restart it
echo "Restarting preview service..."

# Find the preview process
PREVIEW_PID=$(ps aux | grep "npm start\|serve -s" | grep -v grep | awk '{print $1}')

if [ -n "$PREVIEW_PID" ]; then
    echo "Stopping current preview process (PID: $PREVIEW_PID)..."
    kill $PREVIEW_PID
    
    # Wait for process to terminate
    timeout=10
    while kill -0 $PREVIEW_PID 2>/dev/null && [ $timeout -gt 0 ]; do
        sleep 1
        ((timeout--))
    done
    
    if kill -0 $PREVIEW_PID 2>/dev/null; then
        echo "Force killing preview process..."
        kill -9 $PREVIEW_PID
    fi
else
    echo "No running preview process found"
fi

# Start the preview again
echo "Starting new preview process..."

# Check if the project has a specific start script
if grep -q "\"start\":" package.json 2>/dev/null; then
    # Use PORT environment variable for the preview
    export PORT=$PREVIEW_PORT
    
    # Start with nodemon to enable auto-restart on file changes
    nodemon --watch . --ignore node_modules/ --exec "npm start" > /app/preview.log 2>&1 &
else
    echo "No start script found in package.json, using a simple server..."
    # Start a simple server
    serve -s . -l $PREVIEW_PORT > /app/preview.log 2>&1 &
fi

echo "Preview rebuilt and restarted" 