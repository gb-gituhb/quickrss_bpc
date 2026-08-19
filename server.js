const express = require('express');
const puppeteer = require('puppeteer-core');
const path = require('path');
const TurndownService = require('turndown');

const app = express();
const PORT = process.env.PORT || 3000;
const turndownService = new TurndownService();

// Path to the unzipped BPC extension folder
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension/bypass-paywalls-chrome-clean-master');

app.get('/fetch', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL required');

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: 'new',
            args: [
                `--disable-extensions-except=${EXTENSION_PATH}`,
                `--load-extension=${EXTENSION_PATH}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process',
                '--js-flags="--max-old-space-size=256"'
            ]
        });

        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for BPC background scripts to clear cookies and unhide DOM elements
        await new Promise(resolve => setTimeout(resolve, 2500));
        
        // Extract HTML and convert to Markdown for KOReader
        const html = await page.evaluate(() => document.body.innerHTML);
        const markdown = turndownService.turndown(html);
        
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.send(markdown);

    } catch (error) {
        res.status(500).send(error.message);
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT);
