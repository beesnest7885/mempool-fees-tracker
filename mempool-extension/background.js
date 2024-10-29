// Constants for badge colors
const BADGE_COLORS = {
    LOW: '#00FF00',    // Green
    MEDIUM: '#FFA500', // Orange
    HIGH: '#FF0000',   // Red
    VERY_HIGH: '#000000' // Black
};

// Function to determine badge color based on fee
function getBadgeColor(fee) {
    if (fee <= 30) return BADGE_COLORS.LOW;
    if (fee <= 60) return BADGE_COLORS.MEDIUM;
    if (fee <= 100) return BADGE_COLORS.HIGH;
    return BADGE_COLORS.VERY_HIGH;
}

// Function to update the badge and store fetched fee data
function updateBadgeAndStorage(data) {
    const fastestFee = data.fastestFee;
    const badgeColor = getBadgeColor(fastestFee);

    chrome.action.setBadgeText({ text: fastestFee.toString() });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });

    chrome.storage.local.set({ feeData: data, lastUpdated: Date.now() });
}

// Retry logic with exponential backoff
async function fetchWithRetries(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i < retries - 1) {
                console.log(`Retrying fetch... Attempt ${i + 1}`);
                await new Promise((resolve) => setTimeout(resolve, backoff));
            } else {
                console.error(`Failed to fetch after ${retries} attempts:`, error);
                throw error;
            }
        }
    }
}

// Fetch data and update badge
async function fetchDataAndUpdateBadge() {
    try {
        const data = await fetchWithRetries('https://mempool.space/api/v1/fees/recommended');
        updateBadgeAndStorage(data);
    } catch (error) {
        console.error('Error fetching and updating badge:', error);
    }
}

// Initial fetch and set interval for periodic updates
fetchDataAndUpdateBadge();
setInterval(fetchDataAndUpdateBadge, 20000); // Update every minute
