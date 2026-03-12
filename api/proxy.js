// Vercel Serverless Function Proxy for CORS bypass (LingoBooks)
module.exports = async (req, res) => {
    // Enable CORS for our PWA
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ error: 'URL parameter is required.' });
    }

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'LingoBooks-Serverless-Proxy/2.0'
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Downstream request failed with status ${response.status}` });
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        // V10: Crucial fix for EPUB (Binary) vs Text files.
        // We MUST send the raw ArrayBuffer, not .text() to prevent file corruption.
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.status(200).send(buffer);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Failed to proxy request.' });
    }
};
