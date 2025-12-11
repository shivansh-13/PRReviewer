# 🤖 ADO PR Reviewer - AI-Powered Code Review Extension

A browser extension that uses Google Gemini AI to automatically review Pull Requests in Azure DevOps, identifying bugs, security issues, performance problems, and code quality concerns.

## ✨ Features

- **🔍 Thorough Code Review**: Analyzes code changes using Google's Gemini AI
- **🐛 Bug Detection**: Identifies logic errors, null pointer issues, and runtime problems
- **🔒 Security Analysis**: Spots SQL injection, XSS vulnerabilities, authentication issues
- **⚡ Performance Issues**: Detects inefficiencies, memory leaks, and bottlenecks
- **🎨 Code Style**: Reviews code for best practices and conventions
- **📝 Documentation**: Suggests missing comments and documentation
- **🧪 Test Coverage**: Identifies areas lacking test coverage

## 🚀 Installation

### From Source (Developer Mode)

1. **Clone/Download** this repository to your local machine

2. **Open Chrome/Edge Extensions**:
   - Chrome: Navigate to `chrome://extensions/`
   - Edge: Navigate to `edge://extensions/`

3. **Enable Developer Mode**: Toggle the "Developer mode" switch in the top-right corner

4. **Load the Extension**: 
   - Click "Load unpacked"
   - Select the `PRReviewer` folder

5. **Configure API Key**:
   - Click the extension icon in your browser toolbar
   - Enter your [Google Gemini API Key](https://makersuite.google.com/app/apikey)
   - Click "Save Settings"

## 📖 Usage

### Quick Start

1. Navigate to any Pull Request in Azure DevOps
2. Click the extension icon
3. Click "🔍 Review Current File" or "📋 Review All Changes"
4. Wait for the AI analysis to complete
5. Review the identified issues in the floating panel

### Review Options

| Option | Description |
|--------|-------------|
| **Review Current File** | Analyzes only the currently visible file |
| **Review All Changes** | Analyzes all changed files in the PR |
| **Review Selection** | Analyzes only the selected code |
| **Clear AI Comments** | Removes all AI-generated comments |

### Review Depth Settings

- **Quick Review**: Fast analysis focusing on critical issues only
- **Standard Review**: Balanced analysis covering important issues
- **Thorough Review**: Deep analysis checking every detail

### Focus Areas

Configure which types of issues to look for:
- ✅ Bugs & Logic Errors
- ✅ Security Issues  
- ✅ Performance
- ✅ Code Style
- ☐ Naming Conventions
- ☐ Documentation
- ☐ Test Coverage

## 🎯 Issue Severity Levels

| Level | Icon | Description |
|-------|------|-------------|
| **Critical** | 🔴 | Must be fixed before merging - bugs, security issues |
| **Warning** | 🟡 | Should be addressed - performance, potential issues |
| **Suggestion** | 🔵 | Nice to have - style, documentation improvements |

## ⚙️ Configuration

### Getting a Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key and paste it in the extension settings

### Supported Models

| Model | Description | Best For |
|-------|-------------|----------|
| **Gemini 2.0 Flash** | Fast and efficient | Quick reviews |
| **Gemini 1.5 Pro** | Most capable | Thorough analysis |
| **Gemini 1.5 Flash** | Balanced | Standard reviews |

## 🏗️ Project Structure

```
PRReviewer/
├── manifest.json           # Extension configuration
├── popup/
│   ├── popup.html         # Settings UI
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic
├── content/
│   ├── content.js         # Page interaction & review logic
│   └── content.css        # Inline comment styles
├── background/
│   └── background.js      # Service worker
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 🔧 Development

### Prerequisites

- Chrome or Edge browser
- Node.js (optional, for icon generation)
- Google Gemini API Key

### Local Development

1. Make changes to the source files
2. Go to `chrome://extensions/` or `edge://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes on an Azure DevOps PR page

### Building for Production

1. Update version in `manifest.json`
2. Create a ZIP file of the extension folder
3. Upload to Chrome Web Store or Edge Add-ons

## 🐛 Troubleshooting

### Extension Not Working

1. **Check URL**: Make sure you're on a valid Azure DevOps PR page
   - URL should contain `/pullrequest/`
2. **Check API Key**: Verify your Gemini API key is entered correctly
3. **Reload Extension**: Click the refresh button on the extensions page
4. **Check Console**: Open DevTools (F12) and check for errors

### No Issues Found

- The code might genuinely be clean
- Try selecting a specific code section and using "Review Selection"
- Increase review depth to "Thorough Review"

### API Errors

- **401/403**: Invalid API key - regenerate in Google AI Studio
- **429**: Rate limited - wait a moment and try again
- **500**: Server error - try a different model

## 📝 License

MIT License - feel free to modify and distribute.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📧 Support

For issues and feature requests, please create an issue on the repository.

---

**Made with ❤️ for developers tired of reviewing AI-generated code**
