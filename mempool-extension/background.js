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

// Alert configuration
let feeAlertThreshold = null;
let alertTriggered = false;

// Handle messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);
  
  if (message.action === "setFeeAlert") {
    feeAlertThreshold = message.threshold;
    alertTriggered = false;
    
    chrome.storage.local.set({ feeAlertThreshold, alertTriggered }, () => {
      console.log(`Fee alert set: ${feeAlertThreshold} sat/vB`);
      // Send a response back to the popup
      sendResponse({ success: true, message: "Alert set successfully" });
    });
    
    // Return true to indicate you'll send a response asynchronously
    return true;
  } 
  else if (message.action === "clearFeeAlert") {
    feeAlertThreshold = null;
    alertTriggered = false;
    
    chrome.storage.local.remove(['feeAlertThreshold', 'alertTriggered'], () => {
      console.log('Fee alert cleared');
      // Send a response back to the popup
      sendResponse({ success: true, message: "Alert cleared successfully" });
    });
    
    // Return true to indicate you'll send a response asynchronously
    return true;
  }
});

// Load alert settings when service worker starts
function loadAlertSettings() {
    chrome.storage.local.get(['feeAlertThreshold', 'alertTriggered'], (result) => {
        if (result.feeAlertThreshold) {
            feeAlertThreshold = result.feeAlertThreshold;
            alertTriggered = result.alertTriggered || false;
            console.log(`Loaded fee alert: ${feeAlertThreshold} sat/vB`);
        }
    });
}

// Call this at the start of your background.js
loadAlertSettings();

// Function to update the badge and store fetched fee data
function updateBadgeAndStorage(data) {
    const fastestFee = data.fastestFee;
    const badgeColor = getBadgeColor(fastestFee);

    chrome.action.setBadgeText({ text: fastestFee.toString() });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });

    chrome.storage.local.set({ feeData: data, lastUpdated: Date.now() });
    console.log('Badge updated with fee:', fastestFee, 'Color:', badgeColor);
    
    // Check if we should trigger an alert
    checkAndSendAlert(fastestFee);
}

// Function to check and send alerts
function checkAndSendAlert(currentFee) {
    // If no alert is set or alert was already triggered, exit
    if (!feeAlertThreshold || alertTriggered) {
        return;
    }
    
    // Only trigger when fee is EXACTLY equal to the threshold
    if (currentFee === feeAlertThreshold) {
        console.log(`Fee alert triggered! Current: ${currentFee}, Threshold: ${feeAlertThreshold}`);
        
        // Create notification
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'Bitcoin Fee Alert',
            message: `The current fee (${currentFee} sat/vB) is now exactly at your threshold of ${feeAlertThreshold} sat/vB`,
            priority: 2
        });
        
        // Mark alert as triggered to prevent repeated notifications
        alertTriggered = true;
        chrome.storage.local.set({ alertTriggered });
    }
}

// Retry logic with exponential backoff
async function fetchWithRetries(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(url, { 
                signal: controller.signal,
                cache: 'no-cache' // Avoid caching issues
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Fetch attempt ${i + 1} failed:`, error);
            
            if (i < retries - 1) {
                const waitTime = backoff * Math.pow(2, i); // Exponential backoff
                console.log(`Retrying fetch in ${waitTime}ms... Attempt ${i + 2}`);
                await new Promise((resolve) => setTimeout(resolve, waitTime));
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
        console.log('Fetching data...');
        
        // Try to use cached data if we can't fetch new data
        const cachedData = await getCachedFeeData();
        
        try {
            // Try primary endpoint
            const data = await fetchWithRetries('https://mempool.space/api/v1/fees/recommended');
            console.log('Data fetched:', data);
            updateBadgeAndStorage(data);
        } catch (primaryError) {
            console.log('Primary endpoint failed, trying backup endpoint...');
            
            try {
                // Try backup endpoint
                const data = await fetchWithRetries('https://mempool.io/api/v1/fees/recommended');
                console.log('Data fetched from backup:', data);
                updateBadgeAndStorage(data);
            } catch (backupError) {
                console.error('All endpoints failed, using cached data');
                
                if (cachedData) {
                    console.log('Using cached data:', cachedData);
                    updateBadgeAndStorage(cachedData);
                } else {
                    console.error('No cached data available');
                    // Set a default state for the badge
                    chrome.action.setBadgeText({ text: '!' });
                    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
                }
            }
        }
    } catch (error) {
        console.error('Error fetching and updating badge:', error);
    }
}

// Function to get cached fee data
async function getCachedFeeData() {
    return new Promise((resolve) => {
        chrome.storage.local.get('feeData', (result) => {
            if (result.feeData) {
                resolve(result.feeData);
            } else {
                resolve(null);
            }
        });
    });
}

// Set up an alarm to fetch data every 1 minute
chrome.alarms.create('fetchData', { periodInMinutes: 1 });

// Listen for the alarm and fetch data when it triggers
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'fetchData') {
        fetchDataAndUpdateBadge();
    }
});

// Initial fetch when the service worker starts
fetchDataAndUpdateBadge();

// Add to background.js
function setupCaching() {
    chrome.storage.local.get('feeDataCache', data => {
        if (!data.feeDataCache) {
            chrome.storage.local.set({ feeDataCache: {}, cacheTime: Date.now() });
        }
    });
}
