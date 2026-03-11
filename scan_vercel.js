const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const errors = [];
    const networkErrors = [];

    page.on('pageerror', error => {
        errors.push(`[PAGE ERROR] ${error.message}`);
    });

    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(`[CONSOLE ERROR] ${msg.text()}`);
        }
    });

    page.on('response', response => {
        if (!response.ok()) {
            networkErrors.push(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
        }
    });

    try {
        console.log("Navigating to https://english-pwa-six.vercel.app/ ...");
        await page.goto('https://english-pwa-six.vercel.app/', { waitUntil: 'networkidle', timeout: 30000 });

        // Wait for a bit to let things load
        await page.waitForTimeout(5000);

        console.log("--- CONSOLE ERRORS ---");
        errors.forEach(e => console.log(e));
        if (errors.length === 0) console.log("None");

        console.log("--- NETWORK ERRORS ---");
        networkErrors.forEach(e => console.log(e));
        if (networkErrors.length === 0) console.log("None");

    } catch (err) {
        console.error("Failed to load page:", err);
    } finally {
        await browser.close();
    }
})();
