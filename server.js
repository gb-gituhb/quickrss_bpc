const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    console.log('⏳ Waiting for extension to load...');
    await wait(3000);
    
    // Extension detection
    let extensionId = null;
    let extensionFound = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!extensionFound && attempts < maxAttempts) {
      attempts++;
      const targets = await browser.targets();
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
      if (!extensionFound && attempts < maxAttempts) {
        await wait(2000);
      }
    }

    if (!extensionFound) {
      console.log('⚠️ Extension not loaded, continuing...');
    }

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Minimal stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for page to stabilize
    console.log('⏳ Waiting for page to stabilize...');
    await wait(3000);

    // FORCE BPC ACTIVATION - FIX ADDED HERE
    console.log('🔧 Forcing BPC activation...');
    await page.evaluate(() => {
      // Try to trigger BPC manually
      if (window.bpc) {
        console.log('BPC found, activating...');
        if (window.bpc.bypass) {
          window.bpc.bypass();
        }
        if (window.bpc.activate) {
          window.bpc.activate();
        }
      }
      
      // Dispatch custom event
      document.dispatchEvent(new Event('bpc-activate'));
      document.dispatchEvent(new CustomEvent('bpc-activate', { 
        detail: { action: 'bypass' } 
      }));
      
      // Click any BPC buttons
      document.querySelectorAll('[data-bpc], .bpc-bypass, [data-bpc-action="bypass"]').forEach(el => {
        el.click();
      });
      
      // Try to find and click paywall bypass buttons
      const bypassButtons = document.querySelectorAll('button, a');
      bypassButtons.forEach(btn => {
        const text = btn.textContent.toLowerCase();
        if (text.includes('continue reading') || 
            text.includes('read more') || 
            text.includes('bypass') ||
            text.includes('subscribe') && text.includes('free')) {
          btn.click();
        }
      });
      
      // Remove common paywall overlays
      const overlaySelectors = [
        '.paywall',
        '.subscription-wall',
        '.premium-wall',
        '.metered-content',
        '.gateway',
        '[class*="paywall"]',
        '[id*="paywall"]',
        '.wsj-paywall',
        '.bloomberg-paywall',
        '.ft-paywall'
      ];
      
      overlaySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.remove();
          console.log('Removed paywall element:', selector);
        });
      });
      
      // Show hidden content
      document.querySelectorAll('.article-content, .post-content, .story-content, .content, .premium-content').forEach(el => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        el.style.height = 'auto';
      });
      
      // Remove blur
      document.querySelectorAll('[style*="blur"], [class*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
        el.style.blur = '0px';
      });
    });

    // Wait for BPC to work
    console.log('⏳ Waiting for BPC to bypass...');
    await wait(5000);

    // Check for Cloudflare
    const pageContent = await page.content();
    const hasCloudflare = pageContent.includes('cf-wrapper') || 
                         pageContent.includes('challenge-form') ||
                         pageContent.includes('Are you a robot');

    if (hasCloudflare) {
      console.log('⚠️ Cloudflare detected! Waiting for bypass...');
      await wait(15000);
      
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        buttons.forEach(btn => {
          const text = btn.textContent.toLowerCase();
          if (text.includes('verify') || text.includes('continue')) {
            btn.click();
          }
        });
      });
      
      await wait(5000);
    } else {
      console.log('✅ No Cloudflare detected');
    }

    // Remove ads and popups
    await page.evaluate(() => {
      document.querySelectorAll('[class*="ad"], [id*="ad"], [class*="banner"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="cookie"], [id*="cookie"]').forEach(el => el.remove());
      
      // Remove images
      document.querySelectorAll('img').forEach(el => el.remove());
    });

    console.log('📝 Extracting HTML...');
    const htmlContent = await page.content();

    console.log(`✅ Extracted ${htmlContent.length} characters`);

    await browser.close();
    isProcessing = false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);
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
