// Background service worker for ADO PR Reviewer

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('ADO PR Reviewer installed');
    
    // Set default settings
    chrome.storage.sync.set({
      model: 'gemini-2.5-flash-lite',
      reviewDepth: 'standard',
      checkBugs: true,
      checkSecurity: true,
      checkPerformance: true,
      checkStyle: true,
      checkNaming: false,
      checkDocs: false,
      checkTests: false
    });
  }
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'reviewCode') {
    handleCodeReview(request.data, request.settings)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'getSettings') {
    chrome.storage.sync.get(null, (settings) => {
      sendResponse(settings);
    });
    return true;
  }
});

// Handle code review via Gemini API
async function handleCodeReview(codeData, settings) {
  const { apiKey, model } = settings;
  
  if (!apiKey) {
    throw new Error('API key not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: codeData.prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    success: true,
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  };
}

// Context menu for quick review
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'review-selection',
    title: '🤖 Review selected code with AI',
    contexts: ['selection'],
    documentUrlPatterns: [
      'https://dev.azure.com/*',
      'https://*.visualstudio.com/*'
    ]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'review-selection') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'reviewSelection',
      text: info.selectionText
    });
  }
});

console.log('ADO PR Reviewer background service loaded');
