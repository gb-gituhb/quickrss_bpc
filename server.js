const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;

// Helper function for waiting
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Verify extension exists
function verifyExtension() {
  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Extension manifest not found at:', manifestPath);
    return false;
  }
  console.log('✅ Extension found at:', EXTENSION_PATH);
  return true;
}

app.get('/', (req, res) => {
  res.status(200).send('Active');
});

app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter.');
  }

  if (isProcessing) {
    return res.status(429).send('Server is busy processing another request. Please retry in 10 seconds.');
  }

  isProcessing = true;
  let browser, page;

  try {
    console.log(`🌐 Fetching: ${targetUrl}`);

    const response = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--js-flags="--max-old-space-size=128"',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium',
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: 1280,
          height: 720
        }
      }
    });

    browser = response.browser;
    page = response.page;

    // Wait for extension to load
    await wait(2000);
    
    // Extension detection
    const targets = await browser.targets();
    let extensionId = null;
    let extensionFound = false;
    
    for (const target of targets) {
      const url = target.url();
      if (url.startsWith('chrome-extension://')) {
        const match = url.match(/chrome-extension:\/\/([^\/]+)/);
        if (match) {
          extensionId = match[1];
          extensionFound = true;
          console.log(`🔌 Extension found with ID: ${extensionId}`);
          break;
        }
      }
    }
    
    if (!extensionFound) {
      console.log('⚠️ Extension not found, continuing...');
    }

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      Object.defineProperty(navigator, 'plugins', { 
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin' },
            { name: 'Chrome PDF Viewer' },
            { name: 'Native Client' }
          ];
          plugins.length = 3;
          plugins.item = (i) => plugins[i];
          plugins.namedItem = (name) => plugins.find(p => p.name === name);
          return plugins;
        }
      });
      
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      
      window.chrome = { 
        runtime: { 
          id: 'test',
          sendMessage: () => {}
        } 
      };
      
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      }
    });

    // BLOCK EVERYTHING EXCEPT TEXT - FASTER LOADING
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // ONLY load document (HTML) and scripts (for BPC)
      if (['document', 'script', 'xhr', 'fetch'].includes(resourceType)) {
        req.continue();
      } else {
        // Block images, media, fonts, stylesheets (they slow loading)
        req.abort();
      }
    });

    // Navigate with FAST settings
    console.log('⏳ Navigating (fast mode)...');
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded', // FASTER - don't wait for all resources
      timeout: 30000 // Reduced timeout
    });

    // Short wait for BPC to work
    console.log('⏳ Waiting for BPC bypass...');
    await wait(3000);

    // Extract ONLY text content
    console.log('📝 Extracting text content...');
    const textContent = await page.evaluate(() => {
      // Try to get article content
      const articleSelectors = [
        'article',
        '.article-content',
        '.post-content',
        '.story-content',
        '.content',
        '.main-content',
        '[role="article"]',
        '.article-body',
        '.entry-content'
      ];
      
      let content = '';
      
      // Try each selector
      for (const selector of articleSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          // Get text from all matching elements
          for (const el of elements) {
            content += el.innerText || el.textContent || '';
            content += '\n\n';
          }
          break;
        }
      }
      
      // If no article found, get main text
      if (!content) {
        // Remove scripts, styles, nav, footer, header
        const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', '.ad', '.advertisement', '.cookie-banner'];
        removeSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => el.remove());
        });
        
        // Get body text
        content = document.body.innerText || document.body.textContent || '';
      }
      
      // Clean up whitespace
      content = content.replace(/\s+/g, ' ').trim();
      
      // Get title
      const title = document.title || '';
      
      return {
        title: title,
        content: content,
        url: window.location.href
      };
    });

    console.log(`✅ Extracted ${textContent.content.length} characters`);
    console.log(`📄 Title: ${textContent.title}`);

    // Close browser
    await browser.close();
    isProcessing = false;

    // Return JSON with text content (smaller, faster)
    res.setHeader('Content-Type', 'application/json');
    res.json(textContent);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    isProcessing = false;
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  verifyExtension();
});
