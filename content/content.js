// Content script for ADO PR Reviewer
// Runs on Azure DevOps PR pages

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__adoPrReviewerLoaded) {
    return;
  }
  window.__adoPrReviewerLoaded = true;

  // State
  let isReviewing = false;
  let currentSettings = null;

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ping handler to check if content script is loaded
    if (request.action === 'ping') {
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'startReview') {
      handleReview(request.type, request.settings)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response
    }
    
    if (request.action === 'clearComments') {
      clearAllComments();
      sendResponse({ success: true });
      return true;
    }
  });

  // Main review handler
  async function handleReview(type, settings) {
    if (isReviewing) {
      return { success: false, error: 'Review already in progress' };
    }

    isReviewing = true;
    currentSettings = settings;

    try {
      showNotification('🔍 Starting AI code review...', 'info');

      // Extract diff content based on review type
      const diffs = await extractDiffs(type);
      
      if (!diffs || diffs.length === 0) {
        return { success: false, error: 'No code changes found to review' };
      }

      showNotification(`📝 Reviewing ${diffs.length} file(s)...`, 'info');

      // Review each diff
      let totalIssues = 0;
      const stats = { files: diffs.length, critical: 0, warnings: 0, suggestions: 0 };

      for (const diff of diffs) {
        const reviewResult = await reviewDiff(diff, settings);
        
        // reviewResult now contains { summary, issues }
        const issues = reviewResult.issues || [];
        
        if (reviewResult.summary || issues.length > 0) {
          totalIssues += issues.length;
          
          // Count by severity
          issues.forEach(issue => {
            if (issue.severity === 'critical') stats.critical++;
            else if (issue.severity === 'warning') stats.warnings++;
            else stats.suggestions++;
          });

          // Display summary and issues
          displayIssues(diff, reviewResult);
        }
      }

      // Save stats
      await chrome.storage.local.set({ reviewStats: stats });

      showNotification(`✅ Review complete! Found ${totalIssues} issue(s)`, 'success');
      
      return { success: true, issueCount: totalIssues };
    } catch (error) {
      console.error('Review error:', error);
      showNotification(`❌ Review failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    } finally {
      isReviewing = false;
    }
  }

  // Extract diffs from the page
  async function extractDiffs(type) {
    const diffs = [];
    
    // Wait for diff content to load - try multiple selectors for ADO
    await waitForElement('[class*="repos-"], [class*="diff-"], [class*="file-"], .bolt-table, [role="treegrid"]', 10000);
    
    // Additional wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('ADO PR Reviewer: Extracting diffs, type:', type);

    if (type === 'selected') {
      // Get selected text and its context
      const selection = window.getSelection().toString();
      if (selection && selection.trim()) {
        diffs.push({
          filename: 'Selected Code',
          content: selection,
          isSelection: true,
          element: null
        });
        return diffs;
      }
    }

    // Try multiple extraction strategies for Azure DevOps
    let extractedDiffs = [];

    // Strategy -1: ADO API (Best for full file context)
    if (type !== 'selected') {
      extractedDiffs = await extractFromADOApi();
      if (extractedDiffs.length > 0) {
        console.log('ADO PR Reviewer: Found diffs using ADO API strategy');
        return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
      }
    }

    // Strategy 0: Side-by-side diff view (PRIMARY - most accurate)
    extractedDiffs = extractFromSideBySideView();
    if (extractedDiffs.length > 0) {
      console.log('ADO PR Reviewer: Found diffs using side-by-side view strategy');
      return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
    }

    // Strategy 1: Modern ADO diff viewer (repos-changes-viewer)
    extractedDiffs = extractFromModernViewer();
    if (extractedDiffs.length > 0) {
      console.log('ADO PR Reviewer: Found diffs using modern viewer strategy');
      return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
    }

    // Strategy 2: File diff containers
    extractedDiffs = extractFromFileDiffContainers();
    if (extractedDiffs.length > 0) {
      console.log('ADO PR Reviewer: Found diffs using file container strategy');
      return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
    }

    // Strategy 3: Code editor / Monaco editor
    extractedDiffs = extractFromMonacoEditor();
    if (extractedDiffs.length > 0) {
      console.log('ADO PR Reviewer: Found diffs using Monaco editor strategy');
      return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
    }

    // Strategy 4: Generic code blocks
    extractedDiffs = extractFromGenericCodeBlocks();
    if (extractedDiffs.length > 0) {
      console.log('ADO PR Reviewer: Found diffs using generic code blocks strategy');
      return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
    }

    // Strategy 5: Last resort - get all visible text from diff area
    extractedDiffs = extractFromVisibleDiffArea();
    if (extractedDiffs.length > 0) {
      console.log('ADO PR Reviewer: Found diffs using visible diff area strategy');
      return type === 'current' ? [extractedDiffs[0]] : extractedDiffs;
    }

    console.log('ADO PR Reviewer: No diffs found with any strategy');
    return [];
  }

  // Strategy 0: Side-by-side diff view (Azure DevOps specific)
  function extractFromSideBySideView() {
    const diffs = [];
    const filename = getCurrentFileName();
    
    // ADO side-by-side view has two panes - left (original) and right (modified)
    // We only want the RIGHT side (new/modified code) with highlighted additions
    
    // Look for the right side panel (modified/new code)
    const rightSideSelectors = [
      '.side-by-side-diff .right-side',
      '.side-by-side .modified',
      '[class*="right-file"]',
      '[class*="modified-content"]',
      '.compare-right',
      // ADO specific selectors
      '.repos-diff-contents .right',
      '[class*="diff-side"][class*="right"]',
      '.vss-Diff--right',
      // Monaco diff editor right side
      '.monaco-diff-editor .modified',
      '.diff-editor .editor.modified'
    ];

    let rightPanel = null;
    for (const selector of rightSideSelectors) {
      rightPanel = document.querySelector(selector);
      if (rightPanel) break;
    }

    // Also look for inline diff with addition markers
    const additionMarkers = document.querySelectorAll(
      '[class*="addition"], [class*="added"], [class*="insert"], ' +
      '.diff-line-add, .line-add, [class*="diff-add"], ' +
      'tr.add, tr.added, .code-line.add, ' +
      '[class*="diffLine"][class*="add"], ' +
      '.repos-line-content.add, ' +
      // Green highlighted lines in ADO
      '[class*="green"], [class*="plus-line"]'
    );

    let additions = [];
    let addedContent = '';

    // Extract from addition markers (most reliable for actual changes)
    if (additionMarkers.length > 0) {
      console.log(`ADO PR Reviewer: Found ${additionMarkers.length} addition markers`);
      additionMarkers.forEach((line, idx) => {
        const text = line.textContent?.trim() || '';
        if (text && text.length > 0) {
          // Skip line numbers
          const cleanText = text.replace(/^\d+\s*/, '').trim();
          if (cleanText) {
            additions.push({ line: idx + 1, content: cleanText });
            addedContent += cleanText + '\n';
          }
        }
      });
    }

    // If we found additions from markers, use those
    if (additions.length > 0 && addedContent.trim()) {
      diffs.push({
        filename: filename || 'Current File',
        content: addedContent.trim(),
        additions: additions,
        deletions: [],
        hasNewCode: true,
        element: document.body
      });
      return diffs;
    }

    // Fallback: Try to extract from right panel directly
    if (rightPanel) {
      const lines = rightPanel.querySelectorAll(
        '.view-line, [class*="code-line"], [class*="diff-line"], .line'
      );
      
      lines.forEach((line, idx) => {
        const text = line.textContent?.trim() || '';
        const lineClass = (line.className || '').toLowerCase();
        const parentClass = (line.parentElement?.className || '').toLowerCase();
        
        // Check if this is an added/modified line
        const isAddition = lineClass.includes('add') || 
                          lineClass.includes('insert') ||
                          lineClass.includes('new') ||
                          parentClass.includes('add') ||
                          line.querySelector('[class*="add"]');
        
        if (isAddition && text) {
          additions.push({ line: idx + 1, content: text });
          addedContent += `+ ${text}\n`;
        }
      });

      if (additions.length > 0) {
        diffs.push({
          filename: filename || 'Current File',
          content: addedContent.trim(),
          additions: additions,
          deletions: [],
          hasNewCode: true,
          element: rightPanel
        });
      }
    }

    return diffs;
  }

  // Strategy 1: Modern ADO diff viewer
  function extractFromModernViewer() {
    const diffs = [];
    
    // Look for the file tree/list to get all files
    const fileItems = document.querySelectorAll(
      '[class*="repos-changes-item"], ' +
      '[class*="file-item"], ' +
      '.repos-summary-file-path, ' +
      '[data-focuszone*="file"], ' +
      '.file-row, ' +
      '[role="treeitem"]'
    );

    // Get the currently displayed diff content
    const diffContent = extractCurrentDiffContent();
    
    if (diffContent && diffContent.content) {
      diffs.push(diffContent);
    }

    // If we found file items but no diff content, extract file names for context
    if (diffs.length === 0 && fileItems.length > 0) {
      const filename = getCurrentFileName();
      const content = extractAllVisibleCode();
      if (content) {
        diffs.push({
          filename: filename || 'Current File',
          content: content,
          element: document.body
        });
      }
    }

    return diffs;
  }

  // Extract the currently displayed diff content
  function extractCurrentDiffContent() {
    // Try to find diff viewer container
    const diffViewers = document.querySelectorAll(
      '[class*="repos-diff"], ' +
      '[class*="diff-viewer"], ' +
      '[class*="file-content"], ' +
      '.compare-files-container, ' +
      '[class*="side-by-side"], ' +
      '[class*="inline-diff"]'
    );

    for (const viewer of diffViewers) {
      const content = extractDiffFromContainer(viewer);
      if (content && content.content && content.content.trim().length > 50) {
        return content;
      }
    }

    return null;
  }

  // Extract diff from a specific container
  function extractDiffFromContainer(container) {
    if (!container) return null;

    const filename = getCurrentFileName();
    let content = '';
    let additions = [];
    let deletions = [];

    // Look for line elements with various ADO class patterns
    const lineSelectors = [
      // Modern ADO selectors
      '[class*="diff-line"]',
      '[class*="code-line"]',
      '[class*="line-content"]',
      '.view-line',
      // Monaco editor lines
      '.view-lines .view-line',
      // Table-based diff
      'tr[class*="diff"]',
      'tr.added, tr.deleted, tr.unchanged',
      // Generic code lines
      '.line',
      '[role="row"]'
    ];

    let lines = [];
    for (const selector of lineSelectors) {
      lines = container.querySelectorAll(selector);
      if (lines.length > 0) break;
    }

    if (lines.length > 0) {
      lines.forEach((line, index) => {
        const text = line.textContent?.trim() || '';
        if (!text) return;

        const lineNum = index + 1;
        const lineClass = line.className?.toLowerCase() || '';
        const parentClass = line.parentElement?.className?.toLowerCase() || '';
        const combinedClass = lineClass + ' ' + parentClass;

        // Detect additions and deletions
        const isAddition = combinedClass.includes('add') || 
                          combinedClass.includes('insert') || 
                          combinedClass.includes('new') ||
                          combinedClass.includes('plus') ||
                          line.querySelector('[class*="add"], [class*="insert"]');
        
        const isDeletion = combinedClass.includes('delete') || 
                          combinedClass.includes('remove') || 
                          combinedClass.includes('old') ||
                          combinedClass.includes('minus') ||
                          line.querySelector('[class*="delete"], [class*="remove"]');

        if (isAddition) {
          additions.push({ line: lineNum, content: text });
          content += `+ ${text}\n`;
        } else if (isDeletion) {
          deletions.push({ line: lineNum, content: text });
          // Skip deletions - we only want to review new code
        } else {
          // Include some context lines but mark them
          content += `  ${text}\n`;
        }
      });
    }

    // If no structured lines found but we have additions, use only additions
    if (!content.trim() && additions.length > 0) {
      content = additions.map(a => `+ ${a.content}`).join('\n');
    }
    
    // If still no content, try raw text as last resort
    if (!content.trim()) {
      content = container.innerText || container.textContent || '';
    }

    // Return only if we have actual additions (new code)
    return {
      filename: filename || 'Unknown File',
      content: content.trim(),
      additions,
      deletions,
      hasNewCode: additions.length > 0,
      element: container
    };
  }

  // Strategy 2: File diff containers
  function extractFromFileDiffContainers() {
    const diffs = [];
    
    const containers = document.querySelectorAll(
      '.file-container, ' +
      '[class*="file-diff"], ' +
      '[class*="repos-file"], ' +
      '.diff-file'
    );

    containers.forEach(container => {
      const diff = extractDiffFromContainer(container);
      if (diff && diff.content && diff.content.trim().length > 20) {
        diffs.push(diff);
      }
    });

    return diffs;
  }

  // Strategy 3: Monaco editor content
  function extractFromMonacoEditor() {
    const diffs = [];
    
    // Monaco editors in ADO
    const editors = document.querySelectorAll(
      '.monaco-editor, ' +
      '[class*="monaco"], ' +
      '.editor-container'
    );

    editors.forEach(editor => {
      const viewLines = editor.querySelectorAll('.view-lines .view-line');
      if (viewLines.length > 0) {
        let content = '';
        viewLines.forEach(line => {
          content += (line.textContent || '') + '\n';
        });
        
        if (content.trim()) {
          diffs.push({
            filename: getCurrentFileName() || 'Editor Content',
            content: content.trim(),
            element: editor
          });
        }
      }
    });

    return diffs;
  }

  // Strategy 4: Generic code blocks
  function extractFromGenericCodeBlocks() {
    const diffs = [];
    
    const codeBlocks = document.querySelectorAll(
      'pre, code, ' +
      '[class*="code-content"], ' +
      '[class*="source-code"], ' +
      '.hljs'
    );

    codeBlocks.forEach(block => {
      const content = block.textContent?.trim();
      if (content && content.length > 50) {
        diffs.push({
          filename: getCurrentFileName() || 'Code Block',
          content: content,
          element: block
        });
      }
    });

    return diffs;
  }

  // Strategy 5: Visible diff area
  function extractFromVisibleDiffArea() {
    const diffs = [];
    
    // Find the main content area
    const mainSelectors = [
      '[class*="repos-changes"]',
      '[class*="diff-viewer"]',
      '[class*="pull-request-diff"]',
      '[class*="file-content"]',
      '.repos-files-container',
      '[role="main"]',
      '.bolt-page-content'
    ];

    for (const selector of mainSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        const content = extractAllVisibleCode(container);
        if (content && content.length > 100) {
          diffs.push({
            filename: getCurrentFileName() || 'All Changes',
            content: content,
            element: container
          });
          break;
        }
      }
    }

    return diffs;
  }

  // Strategy 6: Azure DevOps REST API (Most reliable for content)
  async function extractFromADOApi() {
    const context = getADOContext();
    if (!context) return [];
    
    console.log('ADO PR Reviewer: Attempting API extraction with context:', context);

    try {
      // 1. Get iterations to find the latest one
      const iterationsUrl = context.isLegacy 
        ? `https://${context.org}.visualstudio.com/${context.project}/_apis/git/repositories/${context.repo}/pullRequests/${context.prId}/iterations?api-version=7.0`
        : `https://dev.azure.com/${context.org}/${context.project}/_apis/git/repositories/${context.repo}/pullRequests/${context.prId}/iterations?api-version=7.0`;
        
      const iterationsResponse = await fetch(iterationsUrl);
      if (!iterationsResponse.ok) {
        console.log('ADO PR Reviewer: Failed to fetch iterations', iterationsResponse.status);
        return [];
      }
      
      const iterations = await iterationsResponse.json();
      if (!iterations.value || iterations.value.length === 0) return [];
      
      const lastIteration = iterations.value[iterations.value.length - 1];
      console.log('ADO PR Reviewer: Latest iteration ID:', lastIteration.id);
      console.log('ADO PR Reviewer: Iteration details:', JSON.stringify(lastIteration, null, 2));
      
      // Get commit IDs for versioned fetching
      const sourceCommit = lastIteration.sourceRefCommit?.commitId;
      const targetCommit = lastIteration.commonRefCommit?.commitId || lastIteration.targetRefCommit?.commitId;
      console.log('ADO PR Reviewer: Source commit:', sourceCommit, 'Target commit:', targetCommit);

      // 2. Get changes in the latest iteration
      const changesUrl = context.isLegacy
        ? `https://${context.org}.visualstudio.com/${context.project}/_apis/git/repositories/${context.repo}/pullRequests/${context.prId}/iterations/${lastIteration.id}/changes?api-version=7.0`
        : `https://dev.azure.com/${context.org}/${context.project}/_apis/git/repositories/${context.repo}/pullRequests/${context.prId}/iterations/${lastIteration.id}/changes?api-version=7.0`;
        
      const changesResponse = await fetch(changesUrl);
      if (!changesResponse.ok) {
        console.log('ADO PR Reviewer: Failed to fetch changes', changesResponse.status);
        return [];
      }
      
      const changes = await changesResponse.json();
      console.log('ADO PR Reviewer: Changes response:', changes);
      
      // Handle changeEntries structure (ADO returns { changeEntries: [...] })
      const changesList = changes.changeEntries || changes.value || [];
      console.log('ADO PR Reviewer: Found', changesList.length, 'changed files');
      
      const diffs = [];
      const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.dll', '.exe', '.woff', '.woff2', '.ttf', '.svg'];
      const MAX_FILE_SIZE = 50000; // Skip files larger than 50KB to avoid rate limits
      const MAX_FILES = 15; // Limit number of files to review
      
      // 3. Fetch content for each change
      for (const change of changesList) {
        // Limit number of files
        if (diffs.length >= MAX_FILES) {
          console.log(`ADO PR Reviewer: Reached file limit (${MAX_FILES}), skipping remaining files`);
          break;
        }
        
        const item = change.item || change;
        if (item.isFolder) continue;
        
        const changeType = change.changeType || 'edit';
        if (changeType === 'delete') continue;
        
        const filePath = item.path;
        if (!filePath) {
          console.log('ADO PR Reviewer: Skipping change without path:', change);
          continue;
        }
        
        if (binaryExtensions.some(ext => filePath.toLowerCase().endsWith(ext))) continue;
        
        console.log('ADO PR Reviewer: Processing file:', filePath, 'changeType:', changeType);
        
        // Fetch new content
        let newContent = '';
        if (sourceCommit) {
          newContent = await fetchFileContentByPath(context, filePath, sourceCommit);
          console.log('ADO PR Reviewer: Fetched new content length:', newContent.length);
          
          // Skip very large files
          if (newContent.length > MAX_FILE_SIZE) {
            console.log(`ADO PR Reviewer: Skipping large file ${filePath} (${newContent.length} chars > ${MAX_FILE_SIZE})`);
            continue;
          }
        }
        
        // Fetch original content (if not add)
        let originalContent = '';
        if (changeType !== 'add' && targetCommit) {
          originalContent = await fetchFileContentByPath(context, filePath, targetCommit);
          console.log('ADO PR Reviewer: Fetched original content length:', originalContent.length);
        }
        
        if (newContent) {
          diffs.push({
            filename: filePath,
            originalContent,
            newContent,
            changeType: changeType,
            isApiDiff: true,
            element: null
          });
        }
      }
      
      console.log('ADO PR Reviewer: API extraction returned', diffs.length, 'diffs');
      return diffs;
      
    } catch (e) {
      console.error('ADO PR Reviewer: API extraction failed', e);
      return [];
    }
  }

  // Helper: Fetch file content from ADO API by Path and Commit
  async function fetchFileContentByPath(context, path, commitId) {
    const url = context.isLegacy
      ? `https://${context.org}.visualstudio.com/${context.project}/_apis/git/repositories/${context.repo}/items?path=${encodeURIComponent(path)}&versionType=commit&version=${commitId}&api-version=7.0`
      : `https://dev.azure.com/${context.org}/${context.project}/_apis/git/repositories/${context.repo}/items?path=${encodeURIComponent(path)}&versionType=commit&version=${commitId}&api-version=7.0`;
    
    console.log('ADO PR Reviewer: Fetching file content from:', url);
      
    try {
      const response = await fetch(url);
      console.log('ADO PR Reviewer: File fetch response status:', response.status);
      if (response.ok) {
        const text = await response.text();
        return text;
      } else {
        const errorText = await response.text();
        console.error('ADO PR Reviewer: File fetch error:', errorText);
      }
    } catch (e) {
      console.error('Failed to fetch file content by path:', e);
    }
    return '';
  }

  // Helper: Fetch file content from ADO API
  async function fetchFileContent(context, objectId) {
    const url = context.isLegacy
      ? `https://${context.org}.visualstudio.com/${context.project}/_apis/git/repositories/${context.repo}/items?objectId=${objectId}&api-version=7.0`
      : `https://dev.azure.com/${context.org}/${context.project}/_apis/git/repositories/${context.repo}/items?objectId=${objectId}&api-version=7.0`;
      
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      console.error('Failed to fetch file content:', e);
    }
    return '';
  }

  // Helper: Parse ADO URL to get context
  function getADOContext() {
    const url = window.location.href;
    
    // Pattern 1: https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{prId}
    const devAzureMatch = url.match(/dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_git\/([^\/]+)\/pullrequest\/(\d+)/);
    if (devAzureMatch) {
      return {
        org: devAzureMatch[1],
        project: devAzureMatch[2],
        repo: devAzureMatch[3],
        prId: devAzureMatch[4],
        isLegacy: false
      };
    }
    
    // Pattern 2: https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{prId}
    const vsMatch = url.match(/([^\.]+)\.visualstudio\.com\/([^\/]+)\/_git\/([^\/]+)\/pullrequest\/(\d+)/);
    if (vsMatch) {
      return {
        org: vsMatch[1],
        project: vsMatch[2],
        repo: vsMatch[3],
        prId: vsMatch[4],
        isLegacy: true
      };
    }
    
    return null;
  }

  // Helper: Get current file name from UI
  function getCurrentFileName() {
    const selectors = [
      '[class*="file-path"] span',
      '[class*="file-name"]',
      '[class*="repos-file-header"]',
      '.file-path',
      '[class*="breadcrumb"] span:last-child',
      '[aria-label*="file"]',
      '.bolt-header-title',
      'h2[class*="file"]'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }

    // Try to extract from URL
    const urlMatch = window.location.href.match(/path=([^&]+)/);
    if (urlMatch) {
      return decodeURIComponent(urlMatch[1]);
    }

    return null;
  }

  // Helper: Extract all visible code from a container
  function extractAllVisibleCode(container = document.body) {
    // Get all text that looks like code
    const codeElements = container.querySelectorAll(
      '.view-line, ' +
      '[class*="code-line"], ' +
      '[class*="diff-line"], ' +
      'pre, code, ' +
      '[class*="line-content"]'
    );

    if (codeElements.length > 0) {
      let content = '';
      codeElements.forEach(el => {
        const text = el.textContent;
        if (text) content += text + '\n';
      });
      return content.trim();
    }

    // Fallback: get text content but try to filter non-code
    const mainContent = container.querySelector('[class*="diff"], [class*="code"], [class*="file-content"]');
    if (mainContent) {
      return mainContent.innerText?.trim() || '';
    }

    return '';
  }

  // Extract diff from a single file container (legacy support)
  function extractSingleDiff(container) {
    return extractDiffFromContainer(container);
  }

  // Get filename from container (legacy support)
  function getFilename(container) {
    if (!container) return getCurrentFileName() || 'Unknown file';
    
    const nameElement = container.querySelector(
      '.file-name, .file-path, [class*="file-header"] a, ' +
      '.file-content-header, [class*="file-path"]'
    );
    return nameElement?.textContent?.trim() || 
           container.getAttribute('data-path') || 
           getCurrentFileName() ||
           'Unknown file';
  }

  // Wait for element to appear
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null); // Resolve with null instead of rejecting
      }, timeout);
    });
  }

  // Review a diff using Gemini API
  async function reviewDiff(diff, settings) {
    const prompt = buildReviewPrompt(diff, settings);
    
    // Log summary for debugging (non-verbose)
    console.log(`ADO PR Reviewer: Reviewing ${diff.filename} (${diff.isApiDiff ? 'API' : 'DOM'} extraction, ${(diff.newContent?.length || diff.content?.length || 0)} chars)`);
    
    try {
      const response = await callGeminiAPI(prompt, settings.apiKey, settings.model);
      return parseReviewResponse(response);
    } catch (error) {
      console.error('Gemini API error:', error);
      throw error;
    }
  }

  // Build the review prompt
  function buildReviewPrompt(diff, settings) {
    const focusAreas = [];
    if (settings.focusAreas.bugs) focusAreas.push('bugs, logic errors, and potential runtime issues');
    if (settings.focusAreas.security) focusAreas.push('security vulnerabilities (SQL injection, XSS, auth issues, etc.)');
    if (settings.focusAreas.performance) focusAreas.push('performance issues and inefficiencies');
    if (settings.focusAreas.style) focusAreas.push('code style and best practices');
    if (settings.focusAreas.naming) focusAreas.push('naming conventions and clarity');
    if (settings.focusAreas.docs) focusAreas.push('missing documentation and comments');
    if (settings.focusAreas.tests) focusAreas.push('test coverage concerns');

    const depthInstructions = {
      quick: 'Focus only on critical issues. Be brief.',
      standard: 'Provide a balanced review covering important issues.',
      thorough: 'Do an in-depth analysis. Check every detail. Be comprehensive.'
    };

    // Handle API-based diffs (full file comparison)
    if (diff.isApiDiff) {
      return `You are an expert code reviewer performing a Pull Request review.
      
FILE: ${diff.filename}
CHANGE TYPE: ${diff.changeType}

I will provide the ORIGINAL code and the NEW code.
1. Identify the changes between the two versions.
2. Review ONLY the NEW/CHANGED code.

ORIGINAL CODE:
\`\`\`
${(diff.originalContent || '').substring(0, 20000)}
\`\`\`

NEW CODE:
\`\`\`
${(diff.newContent || '').substring(0, 20000)}
\`\`\`

CRITICAL REVIEW REQUIREMENTS:
1. Review ONLY the new/changed code - ignore unchanged code
2. ${depthInstructions[settings.reviewDepth] || depthInstructions.standard}
3. Focus areas: ${focusAreas.join(', ')}

FIRST: Provide a brief SUMMARY of what this change does (2-3 sentences max).

CONTEXTUAL ANALYSIS - Flag these issues:
- **Unused exports**: If a new function/class/constant is exported, flag it as needing to be consumed somewhere in the PR
- **Incomplete implementations**: New functions that are declared but might not be called/used
- **Missing imports**: If new code references something that appears to need importing
- **Orphaned code**: New code that doesn't seem to integrate with anything
- **API contracts**: New exported functions should have clear contracts (types, docs)
- **Dead code**: New code paths that can never be reached
- **Missing error handling**: New async functions without try-catch, new promises without .catch()
- **Unfinished TODOs**: New TODO/FIXME comments that should be addressed before merge

PR-SPECIFIC CHECKS:
- If a new function is exported, ask: "Is this export consumed elsewhere in the PR?"
- If a new interface/type is defined, ask: "Is this type used in the PR?"
- If a new constant is exported, ask: "Where is this constant used?"
- Flag any new public API that lacks documentation

RESPONSE FORMAT (JSON object with summary and issues):
{
  "summary": {
    "description": "<2-3 sentence summary of what this code change does>",
    "mainChanges": ["<change 1>", "<change 2>", ...],
    "newExports": ["<list of new exported functions/classes/constants>"],
    "riskLevel": "low" | "medium" | "high"
  },
  "issues": [
    {
      "line": <line number or range like "10-15">,
      "severity": "critical" | "warning" | "suggestion",
      "category": "bug" | "security" | "performance" | "style" | "unused-export" | "incomplete" | "documentation",
      "title": "<brief title>",
      "description": "<detailed explanation>",
      "suggestion": "<how to fix, include code if helpful>"
    }
  ]
}

If no issues found, return: {"summary": {...}, "issues": []}

IMPORTANT: Return ONLY valid JSON object, no markdown or extra text.`;
    }

    // Extract only the new/added lines for review
    let codeToReview = diff.content;
    if (diff.additions && diff.additions.length > 0) {
      // If we have structured additions, use only those
      codeToReview = diff.additions.map(a => a.content).join('\n');
    }

    const additionsCount = diff.additions?.length || 0;

    return `You are an expert code reviewer performing a Pull Request review. Review ONLY the NEW/CHANGED CODE below.

FILE: ${diff.filename}
LINES ADDED: ${additionsCount}

NEW/CHANGED CODE (review ONLY this - these are the additions in the PR):
\`\`\`
${codeToReview.substring(0, 15000)}
\`\`\`

CRITICAL REVIEW REQUIREMENTS:
1. Review ONLY the new/changed code shown above - ignore any existing code
2. ${depthInstructions[settings.reviewDepth] || depthInstructions.standard}
3. Focus areas: ${focusAreas.join(', ')}

FIRST: Provide a brief SUMMARY of what this change does (2-3 sentences max).

CONTEXTUAL ANALYSIS - Flag these issues:
- **Unused exports**: If a new function/class/constant is exported, flag it as needing to be consumed somewhere in the PR
- **Incomplete implementations**: New functions that are declared but might not be called/used
- **Missing imports**: If new code references something that appears to need importing
- **Orphaned code**: New code that doesn't seem to integrate with anything
- **API contracts**: New exported functions should have clear contracts (types, docs)
- **Dead code**: New code paths that can never be reached
- **Missing error handling**: New async functions without try-catch, new promises without .catch()
- **Unfinished TODOs**: New TODO/FIXME comments that should be addressed before merge

PR-SPECIFIC CHECKS:
- If a new function is exported, ask: "Is this export consumed elsewhere in the PR?"
- If a new interface/type is defined, ask: "Is this type used in the PR?"
- If a new constant is exported, ask: "Where is this constant used?"
- Flag any new public API that lacks documentation

RESPONSE FORMAT (JSON object with summary and issues):
{
  "summary": {
    "description": "<2-3 sentence summary of what this code change does>",
    "mainChanges": ["<change 1>", "<change 2>", ...],
    "newExports": ["<list of new exported functions/classes/constants>"],
    "riskLevel": "low" | "medium" | "high"
  },
  "issues": [
    {
      "line": <line number or range like "10-15">,
      "severity": "critical" | "warning" | "suggestion",
      "category": "bug" | "security" | "performance" | "style" | "unused-export" | "incomplete" | "documentation",
      "title": "<brief title>",
      "description": "<detailed explanation>",
      "suggestion": "<how to fix, include code if helpful>"
    }
  ]
}

If no issues found, return: {"summary": {...}, "issues": []}

IMPORTANT: Return ONLY valid JSON object, no markdown or extra text.`;
  }

  // Call Gemini API
  async function callGeminiAPI(prompt, apiKey, model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // Parse the review response
  function parseReviewResponse(response) {
    try {
      // Clean up response - remove markdown code blocks if present
      let cleaned = response.trim();
      cleaned = cleaned.replace(/^```json\n?/i, '').replace(/\n?```$/i, '');
      cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
      
      const parsed = JSON.parse(cleaned);
      
      // Handle new format with summary and issues
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          summary: parsed.summary || null,
          issues: Array.isArray(parsed.issues) ? parsed.issues : []
        };
      }
      
      // Handle old format (just array of issues)
      if (Array.isArray(parsed)) {
        return { summary: null, issues: parsed };
      }
      
      return { summary: null, issues: [] };
    } catch (error) {
      console.warn('Failed to parse review response:', error);
      
      // Try to extract JSON object from response
      const objMatch = response.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          const parsed = JSON.parse(objMatch[0]);
          return {
            summary: parsed.summary || null,
            issues: Array.isArray(parsed.issues) ? parsed.issues : []
          };
        } catch (e) {
          console.error('Failed to extract JSON object:', e);
        }
      }
      
      // Try to extract JSON array from response
      const arrMatch = response.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        try {
          return { summary: null, issues: JSON.parse(arrMatch[0]) };
        } catch (e) {
          console.error('Failed to extract JSON array:', e);
        }
      }
      
      return { summary: null, issues: [] };
    }
  }

  // Display issues on the page
  function displayIssues(diff, reviewResult) {
    const { summary, issues } = reviewResult;
    
    // Create or get the issues panel
    let panel = document.getElementById('ai-review-panel');
    if (!panel) {
      panel = createIssuesPanel();
    }

    const issuesList = panel.querySelector('.ai-issues-list');

    // Display summary first if available
    if (summary) {
      const summaryElement = createSummaryElement(diff.filename, summary);
      issuesList.appendChild(summaryElement);
    }
    
    // Add issues
    if (issues && issues.length > 0) {
      issues.forEach((issue, index) => {
        const issueElement = createIssueElement(diff.filename, issue, index);
        issuesList.appendChild(issueElement);
        
        // Also add inline comment if we can find the line
        if (diff.element && issue.line) {
          addInlineComment(diff.element, issue);
        }
      });
    }

    // Show the panel
    panel.classList.add('visible');
    
    // Update filter counts
    updateFilterCounts();
  }

  // Create summary element
  function createSummaryElement(filename, summary) {
    const el = document.createElement('div');
    el.className = 'ai-summary';
    
    const riskColors = {
      low: '🟢',
      medium: '🟡',
      high: '🔴'
    };

    const mainChanges = summary.mainChanges?.length > 0 
      ? summary.mainChanges.map(c => `<li>${escapeHtml(c)}</li>`).join('') 
      : '<li>No major changes detected</li>';
    
    const newExports = summary.newExports?.length > 0
      ? summary.newExports.map(e => `<span class="ai-export-tag">${escapeHtml(e)}</span>`).join(' ')
      : '<span class="ai-no-exports">None</span>';

    el.innerHTML = `
      <div class="ai-summary-header">
        <span class="ai-summary-icon">📋</span>
        <span class="ai-summary-title">Summary: ${escapeHtml(filename)}</span>
        <span class="ai-risk-badge ai-risk-${summary.riskLevel || 'low'}">${riskColors[summary.riskLevel] || '⚪'} ${(summary.riskLevel || 'low').toUpperCase()} RISK</span>
      </div>
      <div class="ai-summary-description">${escapeHtml(summary.description || 'No description available')}</div>
      <div class="ai-summary-details">
        <div class="ai-summary-section">
          <strong>📝 Main Changes:</strong>
          <ul>${mainChanges}</ul>
        </div>
        <div class="ai-summary-section">
          <strong>📦 New Exports:</strong>
          <div class="ai-exports-list">${newExports}</div>
        </div>
      </div>
    `;

    return el;
  }

  // Create the floating issues panel
  function createIssuesPanel() {
    const panel = document.createElement('div');
    panel.id = 'ai-review-panel';
    panel.className = 'ai-review-panel';
    
    panel.innerHTML = `
      <div class="ai-panel-header">
        <h3>🤖 AI Code Review</h3>
        <div class="ai-panel-actions">
          <button class="ai-btn-minimize" title="Minimize">−</button>
          <button class="ai-btn-close" title="Close">×</button>
        </div>
      </div>
      <div class="ai-panel-filters">
        <button class="ai-filter-btn active" data-filter="all">All</button>
        <button class="ai-filter-btn" data-filter="summary">Summary</button>
        <button class="ai-filter-btn" data-filter="critical">Critical</button>
        <button class="ai-filter-btn" data-filter="warning">Warning</button>
        <button class="ai-filter-btn" data-filter="suggestion">Suggestions</button>
      </div>
      <div class="ai-issues-list"></div>
    `;

    // Add event listeners
    panel.querySelector('.ai-btn-close').addEventListener('click', () => {
      panel.classList.remove('visible');
    });

    panel.querySelector('.ai-btn-minimize').addEventListener('click', () => {
      panel.classList.toggle('minimized');
    });

    panel.querySelectorAll('.ai-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        panel.querySelectorAll('.ai-filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        filterIssues(e.target.dataset.filter);
      });
    });

    // Make draggable
    makeDraggable(panel);

    document.body.appendChild(panel);
    return panel;
  }

  // Create an issue element
  function createIssueElement(filename, issue, index) {
    const el = document.createElement('div');
    el.className = `ai-issue ai-issue-${issue.severity}`;
    el.dataset.severity = issue.severity;
    
    const severityIcon = {
      critical: '🔴',
      warning: '🟡',
      suggestion: '🔵'
    };

    const categoryIcon = {
      bug: '🐛',
      security: '🔒',
      performance: '⚡',
      style: '🎨',
      naming: '📝',
      documentation: '📚',
      testing: '🧪',
      'unused-export': '📦',
      'incomplete': '🚧',
      'unused': '⚠️',
      'orphan': '👻',
      'dead-code': '💀',
      'missing-import': '📥',
      'error-handling': '🛡️'
    };

    el.innerHTML = `
      <div class="ai-issue-header">
        <span class="ai-issue-severity">${severityIcon[issue.severity] || '⚪'}</span>
        <span class="ai-issue-category">${categoryIcon[issue.category] || '📌'} ${issue.category}</span>
        <span class="ai-issue-location">${filename}${issue.line ? `:${issue.line}` : ''}</span>
      </div>
      <div class="ai-issue-title">${escapeHtml(issue.title)}</div>
      <div class="ai-issue-description">${escapeHtml(issue.description)}</div>
      ${issue.suggestion ? `
        <div class="ai-issue-suggestion">
          <strong>💡 Suggestion:</strong>
          <pre>${escapeHtml(issue.suggestion)}</pre>
        </div>
      ` : ''}
      <div class="ai-issue-actions">
        <button class="ai-btn-copy" title="Copy to clipboard">📋 Copy</button>
        <button class="ai-btn-add-comment" title="Add as PR comment">💬 Add Comment</button>
        <button class="ai-btn-dismiss" title="Dismiss">✕ Dismiss</button>
      </div>
    `;

    // Event listeners
    el.querySelector('.ai-btn-copy').addEventListener('click', () => {
      const text = `[${issue.severity.toUpperCase()}] ${issue.title}\n\n${issue.description}${issue.suggestion ? `\n\nSuggestion: ${issue.suggestion}` : ''}`;
      navigator.clipboard.writeText(text);
      showNotification('📋 Copied to clipboard', 'success');
    });

    el.querySelector('.ai-btn-add-comment').addEventListener('click', () => {
      addADOComment(filename, issue);
    });

    el.querySelector('.ai-btn-dismiss').addEventListener('click', () => {
      el.remove();
    });

    return el;
  }

  // Add inline comment to the diff
  function addInlineComment(container, issue) {
    const lineNum = parseInt(issue.line) || 1;
    
    // Find the line in the diff
    const lines = container.querySelectorAll('.code-line, .diff-line, [class*="line-"]');
    const targetLine = lines[lineNum - 1];
    
    if (!targetLine) return;

    // Check if comment already exists
    if (targetLine.querySelector('.ai-inline-comment')) return;

    const comment = document.createElement('div');
    comment.className = `ai-inline-comment ai-severity-${issue.severity}`;
    
    const severityIcon = { critical: '🔴', warning: '🟡', suggestion: '🔵' };
    
    comment.innerHTML = `
      <span class="ai-inline-icon">${severityIcon[issue.severity] || '⚪'}</span>
      <span class="ai-inline-text">${escapeHtml(issue.title)}</span>
      <button class="ai-inline-expand">▼</button>
    `;

    // Expand on click
    comment.querySelector('.ai-inline-expand').addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = comment.querySelector('.ai-inline-details');
      if (expanded) {
        expanded.remove();
        e.target.textContent = '▼';
      } else {
        const details = document.createElement('div');
        details.className = 'ai-inline-details';
        details.innerHTML = `
          <p>${escapeHtml(issue.description)}</p>
          ${issue.suggestion ? `<pre>${escapeHtml(issue.suggestion)}</pre>` : ''}
        `;
        comment.appendChild(details);
        e.target.textContent = '▲';
      }
    });

    targetLine.appendChild(comment);
  }

  // Add comment to Azure DevOps
  function addADOComment(filename, issue) {
    // Try to find and click the "Add comment" button on the line
    const severityLabel = { critical: '🔴 CRITICAL', warning: '⚠️ WARNING', suggestion: '💡 SUGGESTION' };
    
    const commentText = `**${severityLabel[issue.severity] || 'AI REVIEW'}** - ${issue.category}

${issue.title}

${issue.description}

${issue.suggestion ? `**Suggestion:**\n\`\`\`\n${issue.suggestion}\n\`\`\`` : ''}

---
_Generated by AI Code Reviewer_`;

    // Copy to clipboard as fallback
    navigator.clipboard.writeText(commentText);
    showNotification('💬 Comment copied! Paste it in the PR comment box.', 'info');
    
    // Try to trigger ADO's native comment dialog
    const addCommentBtn = document.querySelector('.add-comment-button, [aria-label*="Add comment"]');
    if (addCommentBtn) {
      addCommentBtn.click();
    }
  }

  // Filter issues by severity
  function filterIssues(filter) {
    const summaries = document.querySelectorAll('.ai-summary');
    const issues = document.querySelectorAll('.ai-issue');
    
    if (filter === 'all') {
      // Show everything
      summaries.forEach(s => s.style.display = 'block');
      issues.forEach(issue => issue.style.display = 'block');
    } else if (filter === 'summary') {
      // Show only summaries
      summaries.forEach(s => s.style.display = 'block');
      issues.forEach(issue => issue.style.display = 'none');
    } else {
      // Show only issues matching the filter (hide summaries)
      summaries.forEach(s => s.style.display = 'none');
      issues.forEach(issue => {
        if (issue.dataset.severity === filter) {
          issue.style.display = 'block';
        } else {
          issue.style.display = 'none';
        }
      });
    }
    
    // Update filter button counts
    updateFilterCounts();
  }
  
  // Update filter button counts
  function updateFilterCounts() {
    const panel = document.getElementById('ai-review-panel');
    if (!panel) return;
    
    const summaries = document.querySelectorAll('.ai-summary');
    const issues = document.querySelectorAll('.ai-issue');
    
    let criticalCount = 0;
    let warningCount = 0;
    let suggestionCount = 0;
    
    issues.forEach(issue => {
      const severity = issue.dataset.severity;
      if (severity === 'critical') criticalCount++;
      else if (severity === 'warning') warningCount++;
      else if (severity === 'suggestion') suggestionCount++;
    });
    
    const totalCount = summaries.length + issues.length;
    
    // Update button text with counts
    panel.querySelectorAll('.ai-filter-btn').forEach(btn => {
      const filter = btn.dataset.filter;
      if (filter === 'all') btn.textContent = `All (${totalCount})`;
      else if (filter === 'summary') btn.textContent = `Summary (${summaries.length})`;
      else if (filter === 'critical') btn.textContent = `Critical (${criticalCount})`;
      else if (filter === 'warning') btn.textContent = `Warning (${warningCount})`;
      else if (filter === 'suggestion') btn.textContent = `Suggestions (${suggestionCount})`;
    });
  }

  // Clear all AI comments
  function clearAllComments() {
    // Remove panel
    const panel = document.getElementById('ai-review-panel');
    if (panel) panel.remove();

    // Remove inline comments
    document.querySelectorAll('.ai-inline-comment').forEach(el => el.remove());

    // Remove notifications
    document.querySelectorAll('.ai-notification').forEach(el => el.remove());

    showNotification('🗑️ All AI comments cleared', 'success');
  }

  // Show notification
  function showNotification(message, type = 'info') {
    // Remove existing notifications
    document.querySelectorAll('.ai-notification').forEach(n => n.remove());

    const notification = document.createElement('div');
    notification.className = `ai-notification ai-notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      notification.classList.add('ai-notification-hide');
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }

  // Make element draggable
  function makeDraggable(element) {
    const header = element.querySelector('.ai-panel-header');
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      element.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = `${startLeft + dx}px`;
      element.style.top = `${startTop + dy}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.transition = '';
    });
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Create floating review button on PR pages
  function createFloatingButton() {
    if (document.getElementById('ai-review-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'ai-review-fab';
    fab.className = 'ai-review-fab';
    fab.innerHTML = '🤖';
    fab.title = 'AI Code Review';

    fab.addEventListener('click', async () => {
      // Check if API key is configured
      const settings = await chrome.storage.sync.get(['geminiApiKey', 'model', 'reviewDepth', 
        'checkBugs', 'checkSecurity', 'checkPerformance', 'checkStyle']);
      
      if (!settings.geminiApiKey) {
        showNotification('⚠️ Please configure your Gemini API key in the extension popup', 'error');
        return;
      }

      // Start review
      fab.classList.add('loading');
      fab.innerHTML = '⏳';

      try {
        const result = await handleReview('all', {
          apiKey: settings.geminiApiKey,
          model: settings.model || 'gemini-2.5-flash-lite',
          reviewDepth: settings.reviewDepth || 'standard',
          focusAreas: {
            bugs: settings.checkBugs !== false,
            security: settings.checkSecurity !== false,
            performance: settings.checkPerformance !== false,
            style: settings.checkStyle !== false
          }
        });

        if (!result.success) {
          showNotification(`❌ ${result.error}`, 'error');
        }
      } catch (error) {
        showNotification(`❌ ${error.message}`, 'error');
      } finally {
        fab.classList.remove('loading');
        fab.innerHTML = '🤖';
      }
    });

    document.body.appendChild(fab);
  }

  // Add CSS for the floating button
  function addFabStyles() {
    if (document.getElementById('ai-fab-styles')) return;

    const style = document.createElement('style');
    style.id = 'ai-fab-styles';
    style.textContent = `
      .ai-review-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0078d4, #106ebe);
        color: white;
        border: none;
        font-size: 24px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 99998;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ai-review-fab:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      .ai-review-fab.loading {
        animation: fab-pulse 1s infinite;
        pointer-events: none;
      }

      @keyframes fab-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(0.95); }
      }
    `;
    document.head.appendChild(style);
  }

  // Initialize on page load
  function init() {
    console.log('🤖 ADO PR Reviewer content script loaded');
    
    // Add floating button on PR pages
    if (window.location.href.includes('pullrequest')) {
      addFabStyles();
      // Wait for page to stabilize before adding button
      setTimeout(createFloatingButton, 2000);
    }
  }

  // Run initialization
  init();
})();
