// Popup script for ADO PR Reviewer

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  await loadSettings();
  
  // Setup event listeners
  setupEventListeners();
  
  // Update stats from storage
  await updateStats();
});

// Load settings from storage
async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'geminiApiKey',
    'model',
    'reviewDepth',
    'checkBugs',
    'checkSecurity',
    'checkPerformance',
    'checkStyle',
    'checkNaming',
    'checkDocs',
    'checkTests'
  ]);

  if (settings.geminiApiKey) {
    document.getElementById('api-key').value = settings.geminiApiKey;
  }
  
  if (settings.model) {
    document.getElementById('model-select').value = settings.model;
  }
  
  if (settings.reviewDepth) {
    document.getElementById('review-depth').value = settings.reviewDepth;
  }

  // Load checkbox states (default to checked for main items)
  document.getElementById('check-bugs').checked = settings.checkBugs !== false;
  document.getElementById('check-security').checked = settings.checkSecurity !== false;
  document.getElementById('check-performance').checked = settings.checkPerformance !== false;
  document.getElementById('check-style').checked = settings.checkStyle !== false;
  document.getElementById('check-naming').checked = settings.checkNaming || false;
  document.getElementById('check-docs').checked = settings.checkDocs || false;
  document.getElementById('check-tests').checked = settings.checkTests || false;
}

// Setup all event listeners
function setupEventListeners() {
  // Toggle API key visibility
  document.getElementById('toggle-key').addEventListener('click', () => {
    const input = document.getElementById('api-key');
    const btn = document.getElementById('toggle-key');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🔒';
    } else {
      input.type = 'password';
      btn.textContent = '👁️';
    }
  });

  // Save settings
  document.getElementById('save-settings').addEventListener('click', saveSettings);

  // Review actions
  document.getElementById('review-current').addEventListener('click', () => triggerReview('current'));
  document.getElementById('review-all').addEventListener('click', () => triggerReview('all'));
  document.getElementById('review-selected').addEventListener('click', () => triggerReview('selected'));
  document.getElementById('clear-comments').addEventListener('click', clearComments);
}

// Save settings to storage
async function saveSettings() {
  const settings = {
    geminiApiKey: document.getElementById('api-key').value.trim(),
    model: document.getElementById('model-select').value,
    reviewDepth: document.getElementById('review-depth').value,
    checkBugs: document.getElementById('check-bugs').checked,
    checkSecurity: document.getElementById('check-security').checked,
    checkPerformance: document.getElementById('check-performance').checked,
    checkStyle: document.getElementById('check-style').checked,
    checkNaming: document.getElementById('check-naming').checked,
    checkDocs: document.getElementById('check-docs').checked,
    checkTests: document.getElementById('check-tests').checked
  };

  await chrome.storage.sync.set(settings);
  
  updateStatus('success', '✅ Settings saved successfully!');
  
  setTimeout(() => {
    updateStatus('ready', '⏳ Ready to review');
  }, 2000);
}

// Ensure content script is injected
async function ensureContentScriptInjected(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (error) {
    // Content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content/content.css']
      });
      // Wait a moment for script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    } catch (injectionError) {
      console.error('Failed to inject content script:', injectionError);
      return false;
    }
  }
}

// Trigger review action
async function triggerReview(type) {
  const apiKey = document.getElementById('api-key').value.trim();
  
  if (!apiKey) {
    updateStatus('error', '❌ Please enter your Gemini API key');
    return;
  }

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url.includes('pullrequest')) {
    updateStatus('error', '❌ Please navigate to an Azure DevOps PR page');
    return;
  }

  updateStatus('reviewing', '🔄 Initializing...');
  disableButtons(true);

  try {
    // Ensure content script is loaded
    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) {
      updateStatus('error', '❌ Failed to initialize. Please refresh the page.');
      disableButtons(false);
      return;
    }

    updateStatus('reviewing', '🔄 Analyzing code changes...');

    // Get settings
    const settings = await chrome.storage.sync.get([
      'model',
      'reviewDepth',
      'checkBugs',
      'checkSecurity',
      'checkPerformance',
      'checkStyle',
      'checkNaming',
      'checkDocs',
      'checkTests'
    ]);

    // Send message to content script to start review
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'startReview',
      type: type,
      settings: {
        apiKey: apiKey,
        model: settings.model || 'gemini-2.5-flash-lite',
        reviewDepth: settings.reviewDepth || 'standard',
        focusAreas: {
          bugs: settings.checkBugs !== false,
          security: settings.checkSecurity !== false,
          performance: settings.checkPerformance !== false,
          style: settings.checkStyle !== false,
          naming: settings.checkNaming || false,
          docs: settings.checkDocs || false,
          tests: settings.checkTests || false
        }
      }
    });

    if (response && response.success) {
      updateStatus('success', `✅ Review complete! Found ${response.issueCount || 0} issues`);
      await updateStats();
    } else {
      updateStatus('error', `❌ ${response?.error || 'Review failed'}`);
    }
  } catch (error) {
    console.error('Review error:', error);
    updateStatus('error', `❌ ${error.message || 'Failed to communicate with page'}`);
  } finally {
    disableButtons(false);
  }
}

// Clear AI comments
async function clearComments() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'clearComments' });
    updateStatus('success', '🗑️ AI comments cleared');
    
    // Reset stats
    await chrome.storage.local.set({
      reviewStats: { files: 0, critical: 0, warnings: 0, suggestions: 0 }
    });
    await updateStats();
  } catch (error) {
    updateStatus('error', '❌ Failed to clear comments');
  }
}

// Update status bar
function updateStatus(type, message) {
  const statusBar = document.getElementById('status-bar');
  const statusText = statusBar.querySelector('.status-text');
  const statusIcon = statusBar.querySelector('.status-icon');
  
  statusBar.className = 'status-bar';
  
  switch (type) {
    case 'reviewing':
      statusBar.classList.add('reviewing', 'loading');
      statusIcon.textContent = '🔄';
      break;
    case 'success':
      statusBar.classList.add('success');
      statusIcon.textContent = '✅';
      break;
    case 'error':
      statusBar.classList.add('error');
      statusIcon.textContent = '❌';
      break;
    default:
      statusIcon.textContent = '⏳';
  }
  
  statusText.textContent = message.replace(/^[^\s]+\s/, ''); // Remove emoji from message
}

// Update stats display
async function updateStats() {
  const data = await chrome.storage.local.get('reviewStats');
  const stats = data.reviewStats || { files: 0, critical: 0, warnings: 0, suggestions: 0 };
  
  document.getElementById('stat-files').textContent = stats.files || 0;
  document.getElementById('stat-critical').textContent = stats.critical || 0;
  document.getElementById('stat-warnings').textContent = stats.warnings || 0;
  document.getElementById('stat-suggestions').textContent = stats.suggestions || 0;
}

// Disable/enable buttons
function disableButtons(disabled) {
  const buttons = document.querySelectorAll('#actions-section .btn');
  buttons.forEach(btn => {
    btn.disabled = disabled;
  });
}
