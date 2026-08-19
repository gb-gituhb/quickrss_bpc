const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;

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
        '--disable-web-security', // ADDED: Helps with some sites
        '--disable-features=BlockInsecurePrivateNetworkRequests' // ADDED
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

    // FIXED: Better extension detection
    await page.waitForTimeout(2000); // Wait for extension to load
    
    const targets = await browser.targets();
    let extensionId = null;
    let extensionFound = false;
    
    for (const target of targets) {
      const url = target.url();
      console.log('📋 Target URL:', url);
      
      // Look for extension pages
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
    
    // If not found, try to get extension pages
    if (!extensionFound) {
      console.log('⚠️ Extension not found in targets, trying to access extension page...');
      
      // Try to list all targets again after some time
      await page.waitForTimeout(3000);
      const allTargets = await browser.targets();
      for (const target of allTargets) {
        const url = target.url();
        if (url.startsWith('chrome-extension://')) {
          const match = url.match(/chrome-extension:\/\/([^\/]+)/);
          if (match) {
            extensionId = match[1];
            extensionFound = true;
            console.log(`🔌 Extension found on second attempt: ${extensionId}`);
            break;
          }
        }
      }
    }

    if (!extensionFound) {
      console.log('⚠️ Extension not loaded, continuing without extension ID');
    }

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // Override navigator properties
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
      
      // Mock chrome
      window.chrome = { 
        runtime: { 
          id: 'test',
          sendMessage: () => {}
        } 
      };
      
      // Override permissions
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      }
    });

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000 // Increased for Cloudflare
    });

    // Wait for Cloudflare
    console.log('⏳ Waiting for Cloudflare bypass...');
    await page.waitForTimeout(5000);

    // Check for Cloudflare
    const pageContent = await page.content();
    const hasCloudflare = pageContent.includes('cf-wrapper') || 
                         pageContent.includes('challenge-form') ||
                         pageContent.includes('cf-browser-verification') ||
                         pageContent.includes('cloudflare') ||
                         pageContent.includes('Are you a robot');

    if (hasCloudflare) {
      console.log('⚠️ Cloudflare detected, waiting for bypass...');
      await page.waitForTimeout(10000);
      
      // Try to solve
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        buttons.forEach(btn => {
          const text = btn.textContent.toLowerCase();
          if (text.includes('verify') || text.includes('continue') || text.includes('click')) {
            btn.click();
          }
        });
      });
      
      await page.waitForTimeout(5000);
    }

    // Get content
    const content = await page.content();
    await browser.close();
    isProcessing = false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    isProcessing = false;
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  verifyExtension();
});
