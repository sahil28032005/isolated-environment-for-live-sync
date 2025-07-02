const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const chokidar = require('chokidar');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');

// Environment variables
const PREVIEW_DIR = process.env.PREVIEW_DIR || '/app/preview';
const SOURCE_DIR = process.env.SOURCE_DIR || '/source';
const EDITOR_PORT = process.env.EDITOR_PORT || 3000;

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(express.static(path.join(__dirname, 'public')));

// File system operations
app.get('/api/files', (req, res) => {
  const dirPath = req.query.path || '';
  // Use PREVIEW_DIR for file listing when using Git source
  const sourceType = process.env.SOURCE_TYPE || 'local';
  const baseDir = sourceType === 'git' ? PREVIEW_DIR : SOURCE_DIR;
  const fullPath = path.join(baseDir, dirPath);
  
  try {
    console.log(`Loading files from ${sourceType} directory:`, fullPath);
    const files = listFilesRecursively(fullPath, baseDir);
    console.log('Files found:', JSON.stringify(files));
    res.json(files);
  } catch (error) {
    console.error('Error loading files:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }
  
  // Use appropriate directory based on source type
  const sourceType = process.env.SOURCE_TYPE || 'local';
  const baseDir = sourceType === 'git' ? PREVIEW_DIR : SOURCE_DIR;
  const fullPath = path.join(baseDir, filePath);
  
  try {
    console.log('Reading file:', fullPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/file', (req, res) => {
  const filePath = req.query.path;
  const content = req.body;
  
  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }
  
  // Use appropriate directory based on source type
  const sourceType = process.env.SOURCE_TYPE || 'local';
  const baseDir = sourceType === 'git' ? PREVIEW_DIR : SOURCE_DIR;
  const fullPath = path.join(baseDir, filePath);
  
  try {
    console.log('Writing to file:', fullPath);
    // Ensure directory exists
    const dirPath = path.dirname(fullPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content);
    
    // If using local source, also write to preview directory
    if (sourceType === 'local') {
      const previewPath = path.join(PREVIEW_DIR, filePath);
      const previewDirPath = path.dirname(previewPath);
      if (!fs.existsSync(previewDirPath)) {
        fs.mkdirSync(previewDirPath, { recursive: true });
      }
      fs.writeFileSync(previewPath, content);
    }
    
    res.json({ success: true });
    
    // Notify clients about file change
    io.emit('fileChanged', { path: filePath });
  } catch (error) {
    console.error('Error writing file:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/file', (req, res) => {
  const filePath = req.query.path;
  
  if (!filePath) {
    return res.status(400).json({ error: 'File path is required' });
  }
  
  // Use appropriate directory based on source type
  const sourceType = process.env.SOURCE_TYPE || 'local';
  const baseDir = sourceType === 'git' ? PREVIEW_DIR : SOURCE_DIR;
  const fullPath = path.join(baseDir, filePath);
  
  try {
    console.log('Deleting file:', fullPath);
    fs.unlinkSync(fullPath);
    
    // If using local source, also delete from preview directory
    if (sourceType === 'local') {
      try {
        const previewPath = path.join(PREVIEW_DIR, filePath);
        if (fs.existsSync(previewPath)) {
          fs.unlinkSync(previewPath);
        }
      } catch (previewError) {
        console.error('Error deleting from preview directory:', previewError);
      }
    }
    
    res.json({ success: true });
    
    // Notify clients about file deletion
    io.emit('fileDeleted', { path: filePath });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rebuild and sync operations
app.post('/api/rebuild', (req, res) => {
  exec('/app/scripts/rebuild-preview.sh', (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message, stderr });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/api/sync', (req, res) => {
  exec('/app/scripts/sync-code.sh', (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message, stderr });
    }
    res.json({ success: true, output: stdout });
  });
});

// File watcher - watch both source and preview directories
const watcher = chokidar.watch([SOURCE_DIR, PREVIEW_DIR], {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true
});

watcher
  .on('change', filePath => {
    console.log('File changed:', filePath);
    let relativePath;
    if (filePath.startsWith(SOURCE_DIR)) {
      relativePath = filePath.replace(SOURCE_DIR, '').replace(/^\//, '');
    } else {
      relativePath = filePath.replace(PREVIEW_DIR, '').replace(/^\//, '');
    }
    console.log('Relative path:', relativePath);
    io.emit('fileChanged', { path: relativePath });
  })
  .on('unlink', filePath => {
    console.log('File deleted:', filePath);
    let relativePath;
    if (filePath.startsWith(SOURCE_DIR)) {
      relativePath = filePath.replace(SOURCE_DIR, '').replace(/^\//, '');
    } else {
      relativePath = filePath.replace(PREVIEW_DIR, '').replace(/^\//, '');
    }
    io.emit('fileDeleted', { path: relativePath });
  })
  .on('add', filePath => {
    console.log('File added:', filePath);
    let relativePath;
    if (filePath.startsWith(SOURCE_DIR)) {
      relativePath = filePath.replace(SOURCE_DIR, '').replace(/^\//, '');
    } else {
      relativePath = filePath.replace(PREVIEW_DIR, '').replace(/^\//, '');
    }
    io.emit('fileAdded', { path: relativePath });
  });

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to list files recursively
function listFilesRecursively(dir, rootDir) {
  console.log('Listing files in directory:', dir);
  
  try {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    console.log('Found entries:', entries.length);
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);
      
      if (entry.isDirectory()) {
        files.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children: listFilesRecursively(fullPath, rootDir)
        });
      } else {
        files.push({
          name: entry.name,
          path: relativePath,
          type: 'file'
        });
      }
    }
    
    return files;
  } catch (error) {
    console.error('Error listing files in', dir, ':', error);
    return [];
  }
}

// Start server
server.listen(EDITOR_PORT, () => {
  console.log(`Monaco Editor server running on port ${EDITOR_PORT}`);
}); 