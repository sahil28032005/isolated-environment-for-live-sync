#!/bin/bash
set -e

# Function to sync code to Git
sync_to_git() {
    cd $PREVIEW_DIR
    
    # Check if we have Git credentials
    if [ -z "$GIT_USERNAME" ] || [ -z "$GIT_TOKEN" ]; then
        echo "Git credentials not provided, skipping sync to Git"
        return 1
    fi
    
    # Add all changes
    git add .
    
    # Check if there are changes to commit
    if git diff-index --quiet HEAD --; then
        echo "No changes to commit"
        return 0
    fi
    
    # Commit and push changes
    git commit -m "Auto-sync: Changes from editor at $(date)"
    git push origin ${GIT_BRANCH:-main}
    
    echo "Changes pushed to Git repository"
    return 0
}

# Function to sync code to S3
sync_to_s3() {
    # Check if we have AWS credentials
    if [ -z "$AWS_ACCESS_KEY" ] || [ -z "$AWS_SECRET_KEY" ] || [ -z "$S3_BUCKET" ]; then
        echo "AWS credentials or S3 bucket not provided, skipping sync to S3"
        return 1
    fi
    
    # Sync to S3
    aws s3 sync $PREVIEW_DIR s3://$S3_BUCKET/$S3_KEY --delete
    
    echo "Changes synced to S3 bucket"
    return 0
}

# Function to sync code to source directory
sync_to_local() {
    # Check if source directory is mounted
    if [ ! -d "$SOURCE_DIR" ]; then
        echo "Source directory not mounted, skipping local sync"
        return 1
    fi
    
    # Sync to source directory
    rsync -av --delete $PREVIEW_DIR/ $SOURCE_DIR/
    
    echo "Changes synced to local source directory"
    return 0
}

# Main sync function
sync_code() {
    echo "Syncing code changes..."
    
    # Based on source type, sync to appropriate destination
    case "$SOURCE_TYPE" in
        git)
            sync_to_git
            ;;
        s3)
            sync_to_s3
            ;;
        local)
            sync_to_local
            ;;
        *)
            echo "Unknown source type: $SOURCE_TYPE"
            return 1
            ;;
    esac
}

# If this script is run directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [ "$AUTO_SYNC" = "true" ]; then
        # Run in a loop with the specified interval
        while true; do
            sync_code
            sleep ${SYNC_INTERVAL:-60}
        done
    else
        # Run once
        sync_code
    fi
fi 