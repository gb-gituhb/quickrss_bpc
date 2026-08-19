const express = require('express');
const { connect } = require('puppeteer-real-browser');
const cheerio = require('cheerio');
const path = require('path');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

// ===== MEMORY MANAGEMENT =====
let browserInstance = null;
let browserInUse = false;
let lastBrowserUse = Date.now();
const BROWSER_IDLE_TIMEOUT = 60000;

// Memory monitoring
setInterval(() => {
  const used = process.memoryUsage();
  console.log(`🧠 Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB / ${Math.round(used.heapTotal / 1024 / 1024)}MB`);
  
  if (used.heapUsed > 450 * 1024 * 1024) {
    console.log('⚠️ Emergency restart to prevent OOM');
    process.exit(1);
  }
}, 15000);

// Force GC
setInterval(() => {
  if (global.gc) {
    global.gc();
    console.log('🧹 GC triggered');
  }
}, 30000);

// ===== BROWSER MANAGEMENT =====
async function getBrowser() {
  if (!browserInstance) {
    console.log('🚀 Starting browser...');
    const response = await connect({
      headless: true,
      turnstile: true,
      fingerprint: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--js-flags="--max-old-space-size=128"',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-jit',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-accelerated-video-decode',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium',
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1024, height: 600 }
      }
    });
    
    browserInstance = response.browser;
    console.log('✅ Browser ready');
  }
  
  lastBrowserUse = Date.now();
  return browserInstance;
}

// Close idle browser
setInterval(async () => {
  if (browserInstance && !browserInUse) {
    const idleTime = Date.now() - lastBrowserUse;
    if (idleTime > BROWSER_IDLE_TIMEOUT) {
      console.log('💤 Closing idle browser...');
      try {
        await browserInstance.close();
        browserInstance = null;
        global.gc && global.gc();
      } catch (e) {
        console.log('⚠️ Error closing browser:', e.message);
      }
    }
  }
}, 30000);

// ===== ARCHIVE FETCHER (NO BROWSER) =====
async function fetchArchive(targetUrl) {
  const archiveUrls = [
    `https://web.archive.org/web/2/${targetUrl}`,
    `https://web.archive.org/web/20260819000000/${targetUrl}`
  ];

  for (const archiveUrl of archiveUrls) {
    try {
      console.log(`📚 Trying archive: ${archiveUrl}`);
      
      const response = await fetch(archiveUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (response.ok) {
        const html = await response.text();
        
        if (!html.includes('does not exist') && 
            !html.includes('Not Found') && 
            html.length > 5000) {
          
          console.log(`✅ Archive found`);
          
          const $ = cheerio.load(html);
          
          // Remove paywalls
          $('.paywall, .subscription-wall, .premium-wall, .metered-content, .gateway, [class*="paywall"], [id*="paywall"]').remove();
          
          // Show content
          const contentSelectors = [
            '.article-content', '.post-content', '.story-content', '.content',
            'article', '.main-content', '.entry-content', '.story-body',
            '.article-body', '#content', '.body-content'
          ];
          
          let contentFound = false;
          for (const selector of contentSelectors) {
            if ($(selector).length > 0) {
              $(selector).show();
              contentFound = true;
              break;
            }
          }
          
          if (!contentFound) {
            $('p').show();
          }
          
          $('img').remove();
          $('.ad, .banner, .popup, .cookie, [class*="banner"], [class*="popup"]').remove();
          
          return $.html();
        }
      }
    } catch (error) {
      console.log(`⚠️ Archive failed: ${error.message}`);
    }
  }
  
  return null;
}

// ===== BPC FETCHER =====
async function fetchWithBPC(targetUrl) {
  while (browserInUse) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  browserInUse = true;
  let page = null;
  
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    
    console.log(`🤖 BPC navigating: ${targetUrl}`);
    
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url().toLowerCase();
      
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        req.abort();
        return;
      }
      
      if (url.includes('google-analytics') ||
          url.includes('googletagmanager') ||
          url.includes('facebook') ||
          url.includes('analytics') ||
          url.includes('chartbeat') ||
          url.includes('doubleclick')) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await page.evaluate(() => {
      const selectors = [
        '.paywall', '.subscription-wall', '.premium-wall', '.metered-content',
        '.gateway', '[class*="paywall"]', '[id*="paywall"]', 
        '[class*="subscription"]', '[id*="subscription"]'
      ];
      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      const contentSelectors = [
        '.article-content', '.post-content', '.story-content', '.content',
        'article', '.main-content', '.entry-content', '.story-body',
        '.article-body', '#content'
      ];
      contentSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.opacity = '1';
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
        });
      });
      
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
      });
      
      document.querySelectorAll('img').forEach(el => el.remove());
    });
    
    const content = await page.content();
    return content;
    
  } catch (error) {
    console.error('❌ BPC error:', error.message);
    throw error;
  } finally {
    browserInUse = false;
    if (page) {
      await page.close().catch(() => {});
    }
    lastBrowserUse = Date.now();
  }
}

// ===== MAIN ENDPOINT =====
app.get('/', (req, res) => {
  res.status(200).send('Active');
});

app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter.');
  }

  try {
    console.log(`🌐 Processing: ${targetUrl}`);
    
    const archiveContent = await fetchArchive(targetUrl);
    if (archiveContent) {
      console.log('✅ Returned archive content (no browser)');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(archiveContent);
    }
    
    console.log('📚 Archive failed, using BPC...');
    const bpcContent = await fetchWithBPC(targetUrl);
    
    if (bpcContent) {
      console.log('✅ Returned BPC content');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(bpcContent);
    }
    
    throw new Error('All methods failed');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ BPC Extension path: ${EXTENSION_PATH}`);
  console.log(`🧠 Memory limit: ${process.env.NODE_OPTIONS || '384MB'}`);
  console.log(`📚 Archive-first mode enabled`);
});
