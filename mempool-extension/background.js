// Function to update the badge and store fetched fee data
function updateBadgeAndStorage(data) {
    const fastestFee = data.fastestFee;
    let badgeColor = '#000000';

    if (fastestFee <= 30) {
        badgeColor = '#00FF00';  // Green for low fees
    } else if (fastestFee <= 60) {
        badgeColor = '#FFA500';  // Orange for medium fees
    } else if (fastestFee <= 100) {
        badgeColor = '#FF0000';  // Red for high fees
    } else {
        badgeColor = '#000000';  // Black for very high fees
    }

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
                backoff *= 2;
            } else {
                console.error('Max retries reached. Error fetching fee rates:', error);
                throw error;
            }
        }
    }
}

// Fetch the last 144 blocks' fee rates using the new API endpoint and avgFee_50
async function fetchLast144Blocks() {
    try {
        const data = await fetchWithRetries('https://mempool.space/api/v1/mining/blocks/fee-rates/24h');
        chrome.storage.local.set({ last144Blocks: data }, () => {
            console.log('Stored the latest 144 blocks in local storage.');
        });
    } catch (error) {
        console.error('Error fetching the last 144 blocks:', error);
    }
}

// Main function to fetch and handle fee rates
async function fetchFeeRates() {
    try {
        if (!navigator.onLine) {
            console.log('Browser is offline, using last known fee data.');
            useLastKnownFeeData();
            return;
        }

        const data = await fetchWithRetries('https://mempool.space/api/v1/fees/recommended');
        console.log(`Fetched fee rate: ${data.fastestFee}`);
        updateBadgeAndStorage(data);

        // Check if current fee meets/exceeds user target
        chrome.storage.local.get('targetFeeRate', (result) => {
            const targetFeeRate = result.targetFeeRate;
            if (targetFeeRate && data.fastestFee >= targetFeeRate) {
                sendFeeNotification(data.fastestFee, targetFeeRate);
            }
        });
    } catch (error) {
        console.error('Error fetching fee rates:', error);
        useLastKnownFeeData();
    }
}

// Send fee notification
function sendFeeNotification(currentFee, targetFeeRate) {
    const notificationOptions = {
        type: 'basic',
        iconUrl: 'icon.png', 
        title: 'Bitcoin Fee Rate Alert',
        message: `The current fee rate has reached ${currentFee} sats/vB, meeting your target of ${targetFeeRate} sats/vB.`,
        priority: 2
    };
    chrome.notifications.create('', notificationOptions, function (notificationId) {
        if (chrome.runtime.lastError) {
            console.error('Notification error:', chrome.runtime.lastError.message);
        } else {
            console.log(`Notification sent: ${notificationId}`);
        }
    });
}

// Use stored data if offline
function useLastKnownFeeData() {
    chrome.storage.local.get(['feeData', 'lastUpdated'], function(result) {
        if (result.feeData) {
            const data = result.feeData;
            const fastestFee = data.fastestFee || 'N/A';
            let badgeColor = '#000000';

            if (fastestFee <= 30) badgeColor = '#00FF00';
            else if (fastestFee <= 60) badgeColor = '#FFA500';
            else if (fastestFee <= 100) badgeColor = '#FF0000';

            chrome.action.setBadgeText({ text: fastestFee.toString() });
            chrome.action.setBadgeBackgroundColor({ color: badgeColor });
        } else {
            console.log('No stored data available.');
        }
    });
}

// Add historical block data to the chart, using avgFee_50
function addBlockDataToChart(blocks) {
    const currentTime = Date.now();
    const twentyFourHoursAgo = currentTime - (24 * 60 * 60 * 1000);

    blocks.forEach(block => {
        const blockTimestamp = block.timestamp * 1000; // Convert to milliseconds

        if (blockTimestamp >= twentyFourHoursAgo) {
            const blockFeeInSatsPerVB = block.avgFee_50;  // Use avgFee_50 for chart

            if (blockFeeInSatsPerVB && !isNaN(blockFeeInSatsPerVB)) {
                myChart.data.labels.push(new Date(blockTimestamp));
                myChart.data.datasets[0].data.push(parseFloat(blockFeeInSatsPerVB.toFixed(2))); // Rounded to 2 decimal places
            }
        }
    });

    if (myChart.data.labels.length > 144) {
        myChart.data.labels.splice(0, myChart.data.labels.length - 144);
        myChart.data.datasets[0].data.splice(0, myChart.data.datasets[0].data.length - 144);
    }

    const minFee = Math.min(...myChart.data.datasets[0].data);
    const maxFee = Math.max(...myChart.data.datasets[0].data);
    const padding = 10;

    myChart.options.scales.y.min = Math.max(minFee - padding, 0);
    myChart.options.scales.y.max = maxFee + padding;

    myChart.update();
}

// Online/offline status handling
function updateOnlineStatus() {
    if (navigator.onLine) {
        console.log('Browser is back online, synchronizing data.');
        fetchLast144Blocks(); // Sync the last 144 blocks
        fetchFeeRates(); // Fetch current fee rates
    } else {
        console.log('Browser is offline.');
        displayOfflineMessage();
    }
}

function displayOfflineMessage() {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
}

self.addEventListener('online', updateOnlineStatus);
self.addEventListener('offline', updateOnlineStatus);

chrome.runtime.onInstalled.addListener(() => {
    fetchFeeRates();
    fetchLast144Blocks();
    chrome.alarms.create('fetchFeeRates', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'fetchFeeRates') {
        fetchFeeRates();
    }
});
