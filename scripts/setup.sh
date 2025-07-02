#!/bin/bash
set -e

echo "Setting up environment..."

# Create necessary directories
mkdir -p $PREVIEW_DIR

# Handle different source types
if [ "$SOURCE_TYPE" = "git" ] && [ -n "$GIT_REPO" ]; then
    echo "Cloning repository from Git..."
    
    # Setup git credentials if provided
    if [ -n "$GIT_USERNAME" ] && [ -n "$GIT_TOKEN" ]; then
        git config --global credential.helper store
        echo "https://$GIT_USERNAME:$GIT_TOKEN@github.com" > ~/.git-credentials
        git config --global user.name "$GIT_USERNAME"
        git config --global user.email "$GIT_USERNAME@users.noreply.github.com"
    fi
    
    # Remove preview directory if it exists
    if [ -d "$PREVIEW_DIR" ]; then
        echo "Removing existing preview directory..."
        rm -rf $PREVIEW_DIR
    fi
    
    # Create preview directory
    mkdir -p $PREVIEW_DIR
    
    # Clone the repository
    git clone --branch ${GIT_BRANCH:-main} $GIT_REPO $PREVIEW_DIR
    
elif [ "$SOURCE_TYPE" = "s3" ] && [ -n "$S3_BUCKET" ]; then
    echo "Downloading source from S3..."
    
    # Install AWS CLI if needed
    apk add --no-cache aws-cli
    
    # Configure AWS credentials
    mkdir -p ~/.aws
    echo "[default]" > ~/.aws/credentials
    echo "aws_access_key_id = $AWS_ACCESS_KEY" >> ~/.aws/credentials
    echo "aws_secret_access_key = $AWS_SECRET_KEY" >> ~/.aws/credentials
    
    # Download the source code
    aws s3 cp s3://$S3_BUCKET/$S3_KEY $PREVIEW_DIR --recursive
    
else
    echo "Using local source directory..."
    
    # Copy from mounted source directory
    if [ -d "$SOURCE_DIR" ]; then
        echo "Source directory exists at $SOURCE_DIR"
        if [ "$(ls -A $SOURCE_DIR)" ]; then
            echo "Source directory has files, copying to preview directory"
            mkdir -p $PREVIEW_DIR
            cp -r $SOURCE_DIR/* $PREVIEW_DIR/
            echo "Files copied to preview directory"
            ls -la $PREVIEW_DIR
        else
            echo "Warning: Source directory is empty"
        fi
    else
        echo "Warning: Source directory is not mounted"
    fi
fi

# Install dependencies in the preview directory if package.json exists
if [ -f "$PREVIEW_DIR/package.json" ]; then
    echo "Installing project dependencies..."
    cd $PREVIEW_DIR
    npm install
else
    echo "No package.json found in the project"
fi

echo "Setup complete!" 