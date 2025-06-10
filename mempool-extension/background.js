import { fetchFromEndpoints } from './api.js';

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
            sendResponse({ success: true, message: "Alert set successfully" });
        });
        return true; // Indicate asynchronous response
    } else if (message.action === "clearFeeAlert") {
        feeAlertThreshold = null;
        alertTriggered = false;

        chrome.storage.local.remove(['feeAlertThreshold', 'alertTriggered'], () => {
            console.log('Fee alert cleared');
            sendResponse({ success: true, message: "Alert cleared successfully" });
        });
        return true; // Indicate asynchronous response
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

// Function to update the badge and store fetched fee data
function updateBadgeAndStorage(data) {
    if (!data || typeof data.fastestFee !== 'number') {
        console.error('Invalid fee data:', data);
        return;
    }
    
    const fastestFee = data.fastestFee;
    const badgeColor = getBadgeColor(fastestFee);

    try {
        chrome.action.setBadgeText({ text: fastestFee.toString() });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    } catch (e) {
        console.error('Error updating badge:', e);
    }

    try {
        chrome.storage.local.set({ 
            feeData: data, 
            lastUpdated: Date.now(),
            lastSuccessfulFetch: Date.now()
        });
        console.log('Badge updated with fee:', fastestFee, 'Color:', badgeColor);
    } catch (e) {
        console.error('Error storing data:', e);
    }
    
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

// Retry logic with exponential backoff and improved error handling
async function fetchWithRetries(url, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout to 15 seconds
            
            // Remove User-Agent header which might be causing 403 errors
            const response = await fetch(url, { 
                signal: controller.signal,
                cache: 'no-cache', // Avoid caching issues
                mode: 'cors',
                credentials: 'omit',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            
            // Validate data structure
            if (!data || typeof data.fastestFee !== 'number') {
                throw new Error('Invalid data format received');
            }
            
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
        console.log('Checking online status...');
        const online = await isOnline();
        if (!online) {
            console.log('Offline mode detected. Using cached data.');
            const cachedData = await getCachedFeeData();
            if (cachedData) {
                updateBadgeAndStorage(cachedData);
            } else {
                console.error('No cached data available. Cannot update badge.');
            }
            return;
        }

        console.log('Fetching data...');
        const data = await fetchFromEndpoints();
        updateBadgeAndStorage(data);
    } catch (error) {
        console.error('Error fetching and updating badge:', error);

        // Use cached data as a fallback
        const cachedData = await getCachedFeeData();
        if (cachedData) {
            console.log('Using cached data:', cachedData);
            updateBadgeAndStorage(cachedData);
        } else {
            console.error('No cached data available, using default values');
            const defaultData = createDefaultFeeData();
            updateBadgeAndStorage(defaultData);

            // Set a warning badge to indicate this is estimated
            chrome.action.setBadgeText({ text: 'EST' });
            chrome.action.setBadgeBackgroundColor({ color: '#888888' });
        }
    }
}

// Function to get cached fee data with timestamp validation
async function getCachedFeeData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['feeData', 'lastUpdated'], (result) => {
            if (result.feeData) {
                // Check if cache is still valid (less than 60 minutes old)
                const now = Date.now();
                const cacheAge = now - (result.lastUpdated || 0);
                const maxCacheAge = 60 * 60 * 1000; // 60 minutes
                
                if (cacheAge < maxCacheAge) {
                    resolve(result.feeData);
                } else {
                    console.log('Cache is too old, will try to refresh');
                    resolve(result.feeData); // Still return it, but will try to refresh
                }
            } else {
                resolve(null);
            }
        });
    });
}

// Add this function to create a mock response when everything fails
function createDefaultFeeData() {
    return {
        fastestFee: 10,  // Default conservative values
        halfHourFee: 5,
        hourFee: 3,
        minimumFee: 1,
        economyFee: 1,
        timestamp: Date.now()
    };
}

// Enhanced caching setup
function setupCaching() {
    chrome.storage.local.get(['feeDataCache', 'cacheTime'], data => {
        if (!data.feeDataCache) {
            chrome.storage.local.set({ 
                feeDataCache: {}, 
                cacheTime: Date.now(),
                lastNetworkCheck: Date.now()
            });
        }
    });
}

// Modify the isOnline function to try all of your endpoints
function isOnline() {
    const testEndpoints = [
        'https://mempool.space/api/v1/fees/recommended',
        'https://mempool.io/api/v1/fees/recommended',
        'https://mempool.emzy.de/api/v1/fees/recommended',
        'https://mempool.bisq.services/api/v1/fees/recommended'
    ];

    const promises = testEndpoints.map(url =>
        fetch(url, {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-store'
        })
        .then(() => true)
        .catch(() => false)
    );

    return Promise.all(promises)
        .then(results => results.some(result => result === true))
        .catch(() => false);
}

// Listen for chrome.runtime.onStartup instead of using window events
chrome.runtime.onStartup.addListener(() => {
    console.log('Extension started up, refreshing data...');
    fetchDataAndUpdateBadge();
});

// Initialize the service worker
function initialize() {
    console.log('Initializing background service worker...');
    setupCaching();
    loadAlertSettings();
    
    // Set up an alarm to fetch data at varying frequencies based on failure patterns
    let fetchFrequency = 1; // Default 1 minute
    let consecutiveFailures = 0;
    
    chrome.alarms.create('fetchData', { periodInMinutes: fetchFrequency });
    
    // Also create an alarm to check network status periodically
    chrome.alarms.create('checkNetwork', { periodInMinutes: 5 });
    
    // Initial fetch when the service worker starts
    fetchDataAndUpdateBadge()
        .then(() => {
            consecutiveFailures = 0; // Reset on success
            if (fetchFrequency > 1) {
                fetchFrequency = 1; // Return to normal frequency
                chrome.alarms.create('fetchData', { periodInMinutes: fetchFrequency });
            }
        })
        .catch(() => {
            consecutiveFailures++;
            // Increase interval on continued failures (up to 30 min)
            if (consecutiveFailures > 5) {
                fetchFrequency = Math.min(fetchFrequency * 2, 30);
                chrome.alarms.create('fetchData', { periodInMinutes: fetchFrequency });
            }
        });
    
    // Setup listener for the alarm
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'fetchData') {
            fetchDataAndUpdateBadge()
                .then(() => {
                    consecutiveFailures = 0; // Reset on success
                    if (fetchFrequency > 1) {
                        fetchFrequency = 1; // Return to normal frequency
                        chrome.alarms.create('fetchData', { periodInMinutes: fetchFrequency });
                    }
                })
                .catch(() => {
                    consecutiveFailures++;
                    // Increase interval on continued failures (up to 30 min)
                    if (consecutiveFailures > 5) {
                        fetchFrequency = Math.min(fetchFrequency * 2, 30);
                        chrome.alarms.create('fetchData', { periodInMinutes: fetchFrequency });
                    }
                });
        } else if (alarm.name === 'checkNetwork') {
            // Check network status and update badge if needed
            isOnline().then(online => {
                if (online) {
                    fetchDataAndUpdateBadge();
                } else {
                    chrome.action.setBadgeText({ text: 'OFF' });
                    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
                }
            });
        }
    });
    
    console.log('Bitcoin Fee Tracker initialized successfully');
}

// Start the initialization
initialize();
