console.log("editor.js loaded");

// Global variables
let editor;
let openFiles = {};
let currentFile = null;
let fileTree = {};
let contextMenuTarget = null;
let socket;
let term;
let terminalFitAddon;

// Initialize Socket.IO immediately (no need to wait for DOMContentLoaded)
console.log("Initializing Socket.IO...");
console.log("Socket.IO loaded status:", window.socketIOLoaded);

if (typeof io === 'function') {
  console.log("Socket.IO function found, connecting...");
  socket = io(); // connects to current host
  
  socket.on('connect', () => {
    console.log('🟢 Connected to Socket.IO server');
    setupSocketListeners();
    loadFileTree(); // Load files once connected
  });
  
  socket.on('connect_error', (error) => {
    console.error('❌ Socket.IO connection error:', error);
  });
  
  socket.on('disconnect', () => {
    console.log('🔴 Disconnected from Socket.IO server');
  });
} else {
  console.error('❌ Socket.IO not loaded - cannot initialize connection');
}

// Setup socket event listeners
function setupSocketListeners() {
  console.log('Setting up file event listeners');
  
  // Listen for file changes
  socket.on('fileChanged', (data) => {
    console.log('📄 File changed:', data);
    if (openFiles[data.path] && currentFile !== data.path) {
      // Reload file content if it's open but not the current file
      loadFile(data.path);
    }
    updateStatusMessage(`File changed: ${data.path}`);
  });
  
  socket.on('fileDeleted', (data) => {
    console.log('🗑️ File deleted:', data);
    if (openFiles[data.path]) {
      closeFile(data.path);
    }
    loadFileTree();
    updateStatusMessage(`File deleted: ${data.path}`);
  });
  
  socket.on('fileAdded', (data) => {
    console.log('➕ File added:', data);
    loadFileTree();
    updateStatusMessage(`File added: ${data ? data.path : ''}`);
  });
  
  // Terminal events
  socket.on('terminal:data', (data) => {
    if (term) {
      term.write(data);
    }
  });
  
  socket.on('terminal:created', (data) => {
    console.log('Terminal created with ID:', data.id);
    updateStatusMessage('Terminal ready');
  });
}

// Initialize Monaco Editor
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
require(['vs/editor/editor.main'], function() {
  editor = monaco.editor.create(document.getElementById('editor'), {
    value: '',
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    fontSize: 14,
    tabSize: 2
  });

  // Add change listener
  editor.onDidChangeModelContent(() => {
    if (currentFile) {
      openFiles[currentFile].isDirty = true;
      updateTabStatus(currentFile);
    }
  });

  // Load file tree
  loadFileTree();

  // Set up event listeners
  setupEventListeners();
  
  // Initialize terminal
  initTerminal();
});

// Initialize terminal
function initTerminal() {
  if (typeof Terminal === 'undefined') {
    console.error('xterm.js not loaded');
    return;
  }
  
  // Create terminal
  term = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4'
    },
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    convertEol: true
  });
  
  // Add fit addon
  if (window.FitAddon && window.FitAddon.FitAddon) {
    terminalFitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(terminalFitAddon);
  } else {
    console.warn('FitAddon not available');
  }
  
  // Open terminal
  const terminalElement = document.getElementById('terminal');
  term.open(terminalElement);
  
  // Handle terminal input
  term.onData(data => {
    if (socket && socket.connected) {
      socket.emit('terminal:input', data);
    } else {
      console.error('Socket not connected, cannot send terminal input');
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', resizeTerminal);
  
  // Create terminal on server
  if (socket && socket.connected) {
    socket.emit('terminal:create');
  } else {
    console.error('Socket not connected, cannot create terminal');
  }
  
  // Focus terminal
  setTimeout(() => {
    term.focus();
  }, 100);
}

// Resize terminal
function resizeTerminal() {
  if (term && terminalFitAddon) {
    try {
      terminalFitAddon.fit();
      const dimensions = terminalFitAddon.proposeDimensions();
      if (dimensions && socket && socket.connected) {
        socket.emit('terminal:resize', dimensions);
      }
    } catch (e) {
      console.error('Error resizing terminal:', e);
    }
  }
}

// Toggle terminal
function toggleTerminal() {
  const terminalContainer = document.getElementById('terminal-container');
  const isHidden = terminalContainer.classList.contains('hidden');
  
  if (isHidden) {
    terminalContainer.classList.remove('hidden');
    if (!term) {
      initTerminal();
    } else {
      // Focus terminal
      setTimeout(() => {
        term.focus();
      }, 100);
    }
    
    // Create terminal session if it doesn't exist
    if (socket && socket.connected) {
      socket.emit('terminal:create');
    }
    
    // Resize terminal
    setTimeout(resizeTerminal, 100);
  } else {
    terminalContainer.classList.add('hidden');
  }
}

// Load file tree
function loadFileTree() {
  fetch('/api/files')
    .then(response => response.json())
    .then(data => {
      fileTree = data;
      renderFileTree();
    })
    .catch(error => {
      console.error('Error loading file tree:', error);
      updateStatusMessage('Error loading file tree');
    });
}

// Render file tree
function renderFileTree() {
  const fileTreeElement = document.getElementById('file-tree');
  fileTreeElement.innerHTML = '';
  
  const rootList = document.createElement('ul');
  fileTree.forEach(item => {
    rootList.appendChild(createFileTreeItem(item));
  });
  
  fileTreeElement.appendChild(rootList);
}

// Create file tree item
function createFileTreeItem(item) {
  const li = document.createElement('li');
  li.dataset.path = item.path;
  li.dataset.type = item.type;
  
  const icon = document.createElement('i');
  icon.className = `file-icon fas ${item.type === 'directory' ? 'fa-folder folder' : 'fa-file file'}`;
  
  li.appendChild(icon);
  li.appendChild(document.createTextNode(' ' + item.name));
  
  if (item.type === 'directory') {
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolder(li, item);
    });
    
    if (item.children && item.children.length > 0) {
      const subList = document.createElement('ul');
      subList.style.display = 'none';
      
      item.children.forEach(child => {
        subList.appendChild(createFileTreeItem(child));
      });
      
      li.appendChild(subList);
    }
  } else {
    li.addEventListener('click', () => {
      loadFile(item.path);
    });
  }
  
  // Context menu
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e, item);
  });
  
  return li;
}

// Toggle folder
function toggleFolder(folderElement, item) {
  const subList = folderElement.querySelector('ul');
  if (subList) {
    subList.style.display = subList.style.display === 'none' ? 'block' : 'none';
    
    // Change folder icon
    const icon = folderElement.querySelector('.file-icon');
    if (subList.style.display === 'none') {
      icon.className = 'file-icon fas fa-folder folder';
    } else {
      icon.className = 'file-icon fas fa-folder-open folder';
    }
  }
}

// Load file
function loadFile(path) {
  fetch(`/api/file?path=${encodeURIComponent(path)}`)
    .then(response => response.json())
    .then(data => {
      const fileExtension = path.split('.').pop().toLowerCase();
      const language = getLanguageFromExtension(fileExtension);
      
      if (!openFiles[path]) {
        openFiles[path] = {
          content: data.content,
          language: language,
          isDirty: false
        };
        addTab(path);
      } else {
        openFiles[path].content = data.content;
      }
      
      setCurrentFile(path);
      updateStatusMessage(`Loaded: ${path}`);
    })
    .catch(error => {
      console.error('Error loading file:', error);
      updateStatusMessage('Error loading file');
    });
}

// Save file
function saveFile(path) {
  if (!openFiles[path]) return;
  
  const content = editor.getValue();
  
  fetch(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: content
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        openFiles[path].isDirty = false;
        openFiles[path].content = content;
        updateTabStatus(path);
        updateStatusMessage(`Saved: ${path}`);
      }
    })
    .catch(error => {
      console.error('Error saving file:', error);
      updateStatusMessage('Error saving file');
    });
}

// Add tab
function addTab(path) {
  const tabsElement = document.getElementById('tabs');
  
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.path = path;
  
  const fileName = path.split('/').pop();
  tab.innerHTML = `${fileName} <span class="close-tab">&times;</span>`;
  
  tab.addEventListener('click', () => {
    setCurrentFile(path);
  });
  
  tab.querySelector('.close-tab').addEventListener('click', (e) => {
    e.stopPropagation();
    closeFile(path);
  });
  
  tabsElement.appendChild(tab);
}

// Close file
function closeFile(path) {
  if (!openFiles[path]) return;
  
  // Remove tab
  const tab = document.querySelector(`.tab[data-path="${path}"]`);
  if (tab) tab.remove();
  
  // Remove from open files
  delete openFiles[path];
  
  // If it was the current file, set a new current file
  if (currentFile === path) {
    const nextFile = Object.keys(openFiles)[0];
    if (nextFile) {
      setCurrentFile(nextFile);
    } else {
      currentFile = null;
      editor.setValue('');
      monaco.editor.setModelLanguage(editor.getModel(), 'plaintext');
    }
  }
}

// Set current file
function setCurrentFile(path) {
  if (!openFiles[path]) return;
  
  currentFile = path;
  
  // Update editor content and language
  editor.setValue(openFiles[path].content);
  monaco.editor.setModelLanguage(editor.getModel(), openFiles[path].language);
  
  // Update tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  const currentTab = document.querySelector(`.tab[data-path="${path}"]`);
  if (currentTab) currentTab.classList.add('active');
}

// Update tab status
function updateTabStatus(path) {
  const tab = document.querySelector(`.tab[data-path="${path}"]`);
  if (!tab) return;
  
  const fileName = path.split('/').pop();
  tab.innerHTML = `${openFiles[path].isDirty ? '● ' : ''}${fileName} <span class="close-tab">&times;</span>`;
  
  // Reattach close event listener
  tab.querySelector('.close-tab').addEventListener('click', (e) => {
    e.stopPropagation();
    closeFile(path);
  });
}

// Get language from file extension
function getLanguageFromExtension(extension) {
  const languageMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    php: 'php',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    swift: 'swift',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql'
  };
  
  return languageMap[extension] || 'plaintext';
}

// Show context menu
function showContextMenu(event, item) {
  const contextMenu = document.getElementById('context-menu');
  contextMenuTarget = item;
  
  // Position context menu
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
  contextMenu.style.display = 'block';
  
  // Adjust menu items based on target type
  document.getElementById('new-file').style.display = item.type === 'directory' ? 'block' : 'none';
  document.getElementById('new-folder').style.display = item.type === 'directory' ? 'block' : 'none';
  
  // Close menu when clicking elsewhere
  document.addEventListener('click', closeContextMenu);
}

// Close context menu
function closeContextMenu() {
  document.getElementById('context-menu').style.display = 'none';
  document.removeEventListener('click', closeContextMenu);
}

// Show modal
function showModal(title, placeholder, confirmCallback) {
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalInput = document.getElementById('modal-input');
  const modalConfirm = document.getElementById('modal-confirm');
  
  modalTitle.textContent = title;
  modalInput.placeholder = placeholder;
  modalInput.value = '';
  modal.style.display = 'block';
  modalInput.focus();
  
  // Remove previous event listener
  modalConfirm.replaceWith(modalConfirm.cloneNode(true));
  
  // Add new event listener
  document.getElementById('modal-confirm').addEventListener('click', () => {
    const value = modalInput.value.trim();
    if (value) {
      confirmCallback(value);
      modal.style.display = 'none';
    }
  });
  
  // Close modal
  document.querySelector('.close').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  document.getElementById('modal-cancel').addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  // Close modal when clicking outside
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });
}

// Create new file
function createNewFile(name, parentPath) {
  const path = parentPath ? `${parentPath}/${name}` : name;
  
  fetch(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: ''
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        loadFileTree();
        loadFile(path);
        updateStatusMessage(`Created file: ${path}`);
      }
    })
    .catch(error => {
      console.error('Error creating file:', error);
      updateStatusMessage('Error creating file');
    });
}

// Create new folder
function createNewFolder(name, parentPath) {
  const path = parentPath ? `${parentPath}/${name}` : name;
  
  // Create a placeholder file to make the directory
  fetch(`/api/file?path=${encodeURIComponent(path + '/.placeholder')}`, {
    method: 'POST',
    body: ''
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        loadFileTree();
        updateStatusMessage(`Created folder: ${path}`);
      }
    })
    .catch(error => {
      console.error('Error creating folder:', error);
      updateStatusMessage('Error creating folder');
    });
}

// Delete file or folder
function deleteFileOrFolder(path) {
  if (!path) return;
  
  fetch(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE'
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        if (openFiles[path]) {
          closeFile(path);
        }
        loadFileTree();
        updateStatusMessage(`Deleted: ${path}`);
      }
    })
    .catch(error => {
      console.error('Error deleting:', error);
      updateStatusMessage('Error deleting file or folder');
    });
}

// Rebuild preview
function rebuildPreview() {
  // Save current file first if it's dirty
  if (currentFile && openFiles[currentFile].isDirty) {
    saveFile(currentFile);
  }
  
  updateStatusMessage('Rebuilding preview...');
  
  fetch('/api/rebuild', {
    method: 'POST'
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        updateStatusMessage('Preview rebuilt successfully');
      } else {
        updateStatusMessage('Error rebuilding preview');
      }
    })
    .catch(error => {
      console.error('Error rebuilding preview:', error);
      updateStatusMessage('Error rebuilding preview');
    });
}

// Sync code
function syncCode() {
  // Save current file first if it's dirty
  if (currentFile && openFiles[currentFile].isDirty) {
    saveFile(currentFile);
  }
  
  updateStatusMessage('Syncing code...');
  
  fetch('/api/sync', {
    method: 'POST'
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        updateStatusMessage('Code synced successfully');
      } else {
        updateStatusMessage('Error syncing code');
      }
    })
    .catch(error => {
      console.error('Error syncing code:', error);
      updateStatusMessage('Error syncing code');
    });
}

// Update status message
function updateStatusMessage(message) {
  document.getElementById('status-message').textContent = message;
}

// Setup event listeners
function setupEventListeners() {
  // Refresh files button
  document.getElementById('refresh-files').addEventListener('click', loadFileTree);
  
  // Rebuild button
  document.getElementById('rebuild-btn').addEventListener('click', rebuildPreview);
  
  // Sync button
  document.getElementById('sync-btn').addEventListener('click', syncCode);
  
  // Terminal button
  document.getElementById('terminal-btn').addEventListener('click', toggleTerminal);
  
  // Terminal close button
  document.getElementById('terminal-close').addEventListener('click', () => {
    document.getElementById('terminal-container').classList.add('hidden');
  });
  
  // Context menu items
  document.getElementById('new-file').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.type === 'directory') {
      showModal('New File', 'Enter file name', (name) => {
        createNewFile(name, contextMenuTarget.path);
      });
    }
  });
  
  document.getElementById('new-folder').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.type === 'directory') {
      showModal('New Folder', 'Enter folder name', (name) => {
        createNewFolder(name, contextMenuTarget.path);
      });
    }
  });
  
  document.getElementById('rename').addEventListener('click', () => {
    // Not implemented in this version
    updateStatusMessage('Rename not implemented in this version');
  });
  
  document.getElementById('delete').addEventListener('click', () => {
    if (contextMenuTarget) {
      if (confirm(`Are you sure you want to delete ${contextMenuTarget.name}?`)) {
        deleteFileOrFolder(contextMenuTarget.path);
      }
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (currentFile) {
        saveFile(currentFile);
      }
    }
    
    // Ctrl+` to toggle terminal
    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      toggleTerminal();
    }
  });
} 