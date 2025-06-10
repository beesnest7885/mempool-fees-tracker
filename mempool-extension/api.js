const API_ENDPOINTS = [
    'https://mempool.space/api/v1/fees/recommended',
    'https://mempool.emzy.de/api/v1/fees/recommended',
    'https://mempool.bisq.services/api/v1/fees/recommended'
];

// Function to fetch data with retries and exponential backoff
async function fetchWithRetries(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Attempting to fetch from ${url} (Attempt ${i + 1}/${retries})`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            // Simpler fetch configuration to reduce chance of 403
            const response = await fetch(url, {
                signal: controller.signal,
                mode: 'cors',
                cache: 'no-store' // Changed from no-cache
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log(`Successfully fetched data from ${url}`);
            return data;
        } catch (error) {
            console.error(`Fetch attempt ${i + 1} failed for ${url}:`, error);

            if (i < retries - 1) {
                const waitTime = backoff * Math.pow(2, i); // Exponential backoff
                console.log(`Retrying fetch in ${waitTime}ms...`);
                await new Promise((resolve) => setTimeout(resolve, waitTime));
            } else {
                console.error(`Failed to fetch from ${url} after ${retries} attempts`);
                throw error;
            }
        }
    }
}

// Function to try multiple endpoints in sequence
async function fetchFromEndpoints(endpoints = API_ENDPOINTS) {
    let lastError = null;

    for (const endpoint of endpoints) {
        try {
            console.log(`Trying endpoint: ${endpoint}`);
            const data = await fetchWithRetries(endpoint);

            // Add additional validation
            if (!data || typeof data.fastestFee !== 'number') {
                console.warn(`Invalid data format from ${endpoint}:`, data);
                continue; // Try next endpoint if data is invalid
            }

            console.log(`Data fetched successfully from ${endpoint}`);
            return data;
        } catch (error) {
            console.error(`Endpoint ${endpoint} failed:`, error);
            lastError = error;
        }
    }

    console.error('All endpoints failed');
    throw lastError || new Error('All endpoints failed and no error details available');
}

export { fetchWithRetries, fetchFromEndpoints };