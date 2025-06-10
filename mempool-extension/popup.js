// popup.js
// Wait for module to load before initializing
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const apiModule = await import('./api.js');
    const { fetchFromEndpoints } = apiModule;
    
    // Store for global access
    window.fetchFromEndpoints = fetchFromEndpoints;
    console.log('API module loaded successfully');
    
    // Initialize the app after module is loaded
    init();
  } catch (error) {
    console.error('Failed to load API module:', error);
    // Show error in the UI
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = 'Error loading required modules. Please try again.';
      statusElement.style.color = 'red';
    }
  }
});

const FETCH_INTERVAL = 5000; // Increased frequency of checks to every 5 seconds
const API_URLS = {
    RECOMMENDED_FEES: '/api/v1/fees/recommended',
    LAST_24H_BLOCKS: '/api/v1/mining/blocks/fee-rates/24h',
    LAST_1W_BLOCKS: '/api/v1/mining/blocks/fee-rates/1w',
    LAST_1M_BLOCKS: '/api/v1/mining/blocks/fee-rates/1m',
    BLOCKS: '/api/v1/blocks',
    BTC_PRICE: '/api/v1/prices'
};

// Implement a more robust endpoint fallback system
const API_ENDPOINTS = {
    PRIMARY: 'https://mempool.space',
    FALLBACKS: [
        // 'https://mempool.io', // Removed due to 403 errors
        'https://mempool.emzy.de',
        'https://mempool.bisq.services'
    ]
};

// Track endpoint health
let currentEndpointIndex = 0;
let endpointHealthStatus = API_ENDPOINTS.FALLBACKS.map(() => true);

// More reliable network detection
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_OFFLINE = 3;

function markEndpointUnhealthy(endpointIndex) {
    if (endpointIndex > 0) {
        endpointHealthStatus[endpointIndex - 1] = false;
        
        // Reset endpoint health after some time
        setTimeout(() => {
            endpointHealthStatus[endpointIndex - 1] = true;
        }, 5 * 60 * 1000); // 5 minutes
    }
    
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_OFFLINE) {
        isOfflineMode = true;
        displayOfflineMessage();
    }
}

function resetFailureCount() {
    consecutiveFailures = 0;
}

// Function to get the next healthy endpoint
function getNextHealthyEndpoint() {
    // Start with primary endpoint
    if (currentEndpointIndex === 0) {
        currentEndpointIndex = 1;
        return API_ENDPOINTS.PRIMARY;
    }
    
    // Try to find a healthy fallback
    for (let i = 0; i < API_ENDPOINTS.FALLBACKS.length; i++) {
        const index = (currentEndpointIndex + i) % API_ENDPOINTS.FALLBACKS.length;
        if (endpointHealthStatus[index]) {
            currentEndpointIndex = index + 1;
            return API_ENDPOINTS.FALLBACKS[index];
        }
    }
    
    // If all endpoints are unhealthy, reset and try primary again
    currentEndpointIndex = 0;
    return API_ENDPOINTS.PRIMARY;
}

// Update your URL construction to use this system
function getApiUrl(path) {
    // For block fee rates endpoints, skip mempool.io (which returns 403)
    if (path.startsWith('/api/v1/mining/blocks/fee-rates')) {
        // Only use endpoints that support these paths
        const baseUrls = [
            API_ENDPOINTS.PRIMARY,
            'https://mempool.emzy.de',
            'https://mempool.bisq.services'
        ];
        // Try each endpoint in order, fallback if needed
        for (const baseUrl of baseUrls) {
            // Optionally, you could check endpoint health here
            return `${baseUrl}${path}`;
        }
    }
    // For other endpoints, use all fallbacks (mempool.io removed)
    const baseUrl = getNextHealthyEndpoint();
    return `${baseUrl}${path}`;
}

let lastBlockHeight = null;
let lastBlockTimestamp = null;
let myChart = null;
let currentTimeWindow = '24h'; // Default time window
let feeAlertThreshold = null; // Initialize alert state
let lastBitcoinPrice = null;
let bitcoinPriceChange = null;
let isOfflineMode = false; // Add a global variable to track offline status

// Enhanced offline detection
async function checkConnectivity() {
    // Fast-fail if browser reports offline
    if (!navigator.onLine) {
        return false;
    }
    
    // Try to fetch a small resource from each endpoint
    const testUrl = getApiUrl('/api/v1/difficulty-adjustment');
    try {
        const response = await fetch(testUrl, {
            method: 'HEAD',
            cache: 'no-store',
            mode: 'cors',
            credentials: 'omit',
            headers: { 'Accept': 'application/json' },
            timeout: 5000 // Short timeout for quick check
        });
        return response.ok;
    } catch (error) {
        console.log('Connectivity test failed:', error);
        return false;
    }
}

// Helper to format time ago
function timeAgo(timestamp) {
    const now = Date.now() / 1000;
    const diff = Math.floor(now - timestamp);
    if (diff < 60) return `${diff} seconds ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    const d = new Date(timestamp * 1000);
    return d.toLocaleString();
}

// Fetch and display last block mined info
async function updateLastBlockMined() {
    const el = document.getElementById('lastBlockMined');
    if (!el) return;
    try {
        const url = getApiUrl(API_URLS.BLOCKS);
        const blocks = await apiRequest(url);
        if (Array.isArray(blocks) && blocks.length > 0 && blocks[0].timestamp) {
            el.textContent = `Last block mined: ${timeAgo(blocks[0].timestamp)}`;
        } else {
            el.textContent = 'Last block: Data unavailable';
        }
    } catch (e) {
        el.textContent = 'Last block: Error fetching data';
    }
}

function init() {
    console.log("Initializing popup...");
    
    const statusElement = document.getElementById('status');
    
    if (!statusElement) {
        console.error('Status element is missing in the DOM');
    } else {
        const lastBlockTimeDisplay = document.createElement('span');
        statusElement.appendChild(lastBlockTimeDisplay);
    }

    // Set up the chart with retries
    let chartSetupAttempts = 0;
    const setupChartWithRetry = () => {
        console.log(`Attempt ${chartSetupAttempts + 1} to setup chart`);
        if (setupChart()) {
            console.log("Chart setup successful");
        } else if (chartSetupAttempts < 3) {
            chartSetupAttempts++;
            console.log(`Chart setup failed, retrying (${chartSetupAttempts}/3)...`);
            setTimeout(setupChartWithRetry, 500);
        } else {
            console.error("Failed to set up chart after multiple attempts");
        }
    };
    
    setupChartWithRetry();
    
    // Wait for chart to be ready before fetching data
    setTimeout(() => {
        if (navigator.onLine && !isOfflineMode) {
            fetchData();
            
            // Set interval for periodic data updates
            window.fetchIntervalId = setInterval(fetchData, FETCH_INTERVAL);
        } else {
            displayOfflineMessage();
        }
    }, 1000); // Give more time for chart to initialize
    
    // Add listeners for online/offline events
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    
    // Add event listeners to buttons for time window selection
    document.querySelectorAll('.time-window-btn').forEach(button => {
        button.addEventListener('click', function() {
            // Update active button
            document.querySelectorAll('.time-window-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Set the current time window based on the button's data attribute
            currentTimeWindow = this.getAttribute('data-window');
            updateTimeWindow();
        });
    });

    // Add event listeners for the fee alert buttons
    const setAlertBtn = document.getElementById('setAlertBtn');
    const clearAlertBtn = document.getElementById('clearAlertBtn');
    
    if (setAlertBtn) {
        setAlertBtn.addEventListener('click', setFeeAlert);
    } else {
        console.error("Set Alert button not found");
    }
    
    if (clearAlertBtn) {
        clearAlertBtn.addEventListener('click', clearFeeAlert);
    } else {
        console.error("Clear Alert button not found");
    }
    
    // Load any saved alert threshold
    loadAlertSettings();
    
    // Setup details toggle for dynamic height
    setupDetailsToggle();
    
    // Add theme toggle setup
    setupThemeToggle();
    
    updateLastBlockMined();
    setInterval(updateLastBlockMined, FETCH_INTERVAL * 2);
    
    console.log("Popup initialization complete");
}

// Setup the fee rate chart
function setupChart() {
  console.log("Setting up chart...");

  if (typeof Chart === 'undefined') {
    console.error('Chart.js library not loaded!');
    return false;
  }

  const ctx = document.getElementById('myChart');
  if (!ctx) {
    console.error('Chart canvas element "myChart" not found in the DOM');
    return false;
  }

  try {
    // Properly destroy any existing chart
    if (window.myChart instanceof Chart) {
      window.myChart.destroy();
      console.log('Previous chart instance destroyed');
    }

    window.myChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Median Fee Rate (sat/vB)',
          data: [],
          borderColor: '#f7931a',
          backgroundColor: 'rgba(247, 147, 26, 0.1)',
          borderWidth: 2,
          pointRadius: 2,
          pointBackgroundColor: '#f7931a',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(200, 200, 200, 0.2)' },
            ticks: { callback: value => `${value} sat/vB` }
          }
        }
      }
    });

    myChart = window.myChart;
    console.log('Chart initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing chart:', error);
    return false;
  }
}

// Theme toggle functionality
function setupThemeToggle() {
    console.log("Setting up theme toggle");
    const toggleBtn = document.getElementById('themeToggle');
    if (!toggleBtn) {
        console.error("Theme toggle button not found");
        return;
    }
    
    // Function to apply theme
    const applyTheme = (theme) => {
        if (theme === 'light') {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }
        updateChartTheme(theme);
    };
    
    // Check if a theme preference is stored
    chrome.storage.local.get('theme', (result) => {
        applyTheme(result.theme || 'dark');
    });
    
    toggleBtn.addEventListener('click', () => {
        const isLightMode = document.body.classList.contains('light-mode');
        const newTheme = isLightMode ? 'dark' : 'light';
        
        // Save the theme preference
        chrome.storage.local.set({ theme: newTheme });
        applyTheme(newTheme);
    });
}

// Function to update chart theme based on current mode
function updateChartTheme(theme) {
    if (!myChart) return;
    
    if (theme === 'light') {
        // Light theme chart colors
        myChart.options.scales.x.ticks.color = '#333';
        myChart.options.scales.y.ticks.color = '#333';
        myChart.options.scales.y.grid.color = 'rgba(0, 0, 0, 0.1)';
    } else {
        // Dark theme chart colors
        myChart.options.scales.x.ticks.color = '#f8f8f8';
        myChart.options.scales.y.ticks.color = '#f8f8f8';
        myChart.options.scales.y.grid.color = 'rgba(200, 200, 200, 0.2)';
    }
    
    // Update the chart to reflect the new theme
    myChart.update();
}

// Normalize block data from different APIs to a common structure
function normalizeBlockData(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(block => {
    // mempool.space: { medianFee, timestamp }
    if (typeof block.medianFee === 'number' && typeof block.timestamp === 'number') {
      return block;
    }
    // mempool.io: { fee, time } or { fee, timestamp }
    if (typeof block.fee === 'number' && (typeof block.time === 'number' || typeof block.timestamp === 'number')) {
      return { medianFee: block.fee, timestamp: block.time || block.timestamp };
    }
    // Some APIs may use 'median_fee' and 'ts'
    if (typeof block.median_fee === 'number' && typeof block.ts === 'number') {
      return { medianFee: block.median_fee, timestamp: block.ts };
    }
    // Some APIs may use 'median' and 't'
    if (typeof block.median === 'number' && typeof block.t === 'number') {
      return { medianFee: block.median, timestamp: block.t };
    }
    // Try to extract a number from any property that looks like a fee
    const feeKey = Object.keys(block).find(k => k.toLowerCase().includes('fee'));
    const timeKey = Object.keys(block).find(k => k.toLowerCase().includes('time') || k.toLowerCase().includes('ts'));
    if (feeKey && timeKey && typeof block[feeKey] === 'number' && typeof block[timeKey] === 'number') {
      return { medianFee: block[feeKey], timestamp: block[timeKey] };
    }
    return null;
  }).filter(Boolean);
}

// Improve updateChart to handle invalid data better
function updateChart(data) {
    if (!myChart) {
        console.error('Chart not initialized');
        return;
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
        console.error('Invalid chart data format:', data);
        return;
    }

    try {
        // Normalize data from different APIs
        const normalizedData = normalizeBlockData(data);
        if (normalizedData.length === 0) {
            // Log the first few objects for debugging
            console.error('No valid data points extracted from data. Example data:', data.slice(0, 3));
            // Optionally, show a message in the chart area
            myChart.data.labels = [];
            myChart.data.datasets[0].data = [];
            myChart.update();
            return;
        }
        const labels = [];
        const feeRates = [];

        for (const block of normalizedData) {
            const date = new Date(block.timestamp * 1000);
            labels.push(formatBlockTime(date));
            feeRates.push(block.medianFee);
        }

        myChart.data.labels = labels;
        myChart.data.datasets[0].data = feeRates;

        myChart.update();
        console.log(`Chart updated with ${labels.length} data points`);
    } catch (error) {
        console.error('Error updating chart:', error);
    }
}

// Helper function to format block time
function formatBlockTime(date) {
    if (currentTimeWindow === '24h') {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (currentTimeWindow === '1w') {
        return date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
}

// Setup details toggle for dynamic height
function setupDetailsToggle() {
    const details = document.querySelectorAll('details');
    
    details.forEach(detail => {
        detail.addEventListener('toggle', () => {
            // When details are toggled, we may need to update the height
            // This helps with animation smoothness
            if (detail.open) {
                const content = detail.querySelector('.fee-alert-content');
                if (content) {
                    content.style.maxHeight = content.scrollHeight + 'px';
                }
            }
        });
    });
}

// Helper function to get the current time window API endpoint
function getCurrentTimeWindowAPI() {
    switch(currentTimeWindow) {
        case '24h':
            return getApiUrl(API_URLS.LAST_24H_BLOCKS);
        case '1w':
            return getApiUrl(API_URLS.LAST_1W_BLOCKS);
        case '1m':
            return getApiUrl(API_URLS.LAST_1M_BLOCKS);
        default:
            return getApiUrl(API_URLS.LAST_24H_BLOCKS);
    }
}

// Function to update time window when button is clicked
function updateTimeWindow() {
    console.log(`Updating time window to ${currentTimeWindow}`);
    
    // Start with cached data if available
    const url = getCurrentTimeWindowAPI();
    
    if (navigator.onLine && !isOfflineMode) {
        // Fetch new data for the selected time window
        fetchDataFromAPI(url, processLatestBlockData).catch(handleFetchError);
    } else {
        // Use cached data if available
        displayOfflineMessage();
    }
}

// Modified function to safely process and update chart data
function processLatestBlockData(data) {
  console.log("Processing block data:", data ? data.length : 'no data');
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    console.error('Invalid block data received:', data);
    // Try to use cached data
    try {
      const cached = localStorage.getItem(`blockData_${currentTimeWindow}`);
      if (cached) {
        data = JSON.parse(cached);
        console.log('Using cached block data from localStorage');
      } else {
        console.error('No cached data available');
        return;
      }
    } catch (e) {
      console.error('Error parsing cached data:', e);
      return;
    }
  }
  
  // Only update the chart if it exists and is initialized
  if (window.myChart) {
    try {
      updateChart(data);
      
      // Save the data for offline use
      localStorage.setItem(`blockData_${currentTimeWindow}`, JSON.stringify(data));
      
      console.log(`Processed ${data.length} blocks for time window: ${currentTimeWindow}`);
    } catch (error) {
      console.error("Error updating chart with data:", error);
    }
  } else {
    console.error('Cannot update chart - chart not initialized');
    // Try initializing the chart if it doesn't exist
    if (setupChart()) {
      setTimeout(() => updateChart(data), 100);
    }
  }
}

// Function to check and update online status display
function updateOnlineStatus() {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;
    
    if (navigator.onLine && !isOfflineMode) {
        statusElement.textContent = 'Online: Latest fee data loaded';
        statusElement.classList.remove('offline');
    } else {
        statusElement.textContent = 'Offline: Using cached data';
        statusElement.classList.add('offline');
    }
}

// Modify the fetchData function to respect offline mode
function fetchData() {
  if (!navigator.onLine || isOfflineMode) {
    console.log('In offline mode, using cached data instead of fetching');
    displayOfflineMessage();
    return;
  }

  console.log('Fetching data...');
  
  // Add try/catch blocks to each fetch
  try {
    fetchDataFromAPI(getApiUrl(API_URLS.RECOMMENDED_FEES), displayFeeRates)
      .catch(handleFetchError);
      
    fetchDataFromAPI(getCurrentTimeWindowAPI(), processLatestBlockData)
      .catch(handleFetchError);
      
    fetchDataFromAPI(getApiUrl(API_URLS.BTC_PRICE), displayBitcoinPrice)
      .catch(error => {
        console.error('Error fetching BTC price:', error);
      });
  } catch (error) {
    console.error('Error in fetchData:', error);
    displayOfflineMessage();
  }

  updateOnlineStatus();
}

// Create a unified API request function to avoid duplicate code
async function apiRequest(url, options = {}) {
    // Check if we're offline first
    if (!navigator.onLine) {
        throw new Error('Browser is offline');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            cache: 'no-cache',
            mode: 'cors',
            credentials: 'omit',
            headers: {
                'Accept': 'application/json'
            },
            ...options
        });
        
        clearTimeout(timeoutId);
        if (response.status === 403) {
            console.warn(`API 403 Forbidden for ${url}, skipping this endpoint.`);
            throw new Error('HTTP 403');
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const text = await response.text();
        if (!text) {
            throw new Error(`Empty response from ${url}`);
        }
        
        return JSON.parse(text);
    } catch (error) {
        // Don't log network errors when offline
        if (error.name === 'AbortError' || error.message.includes('Failed to fetch')) {
            throw new Error('Network request failed - likely offline');
        }
        console.error(`API request failed for ${url}:`, error);
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Modified fetchDataFromAPI with better error handling
async function fetchDataFromAPI(url, callback) {
    if (!navigator.onLine || isOfflineMode) {
        console.log('Skipping API fetch in offline mode:', url);
        return Promise.reject(new Error('In offline mode'));
    }

    let retries = 3;
    let lastError = null;
    
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Fetching data from: ${url} (Attempt ${i + 1}/${retries})`);
            const data = await apiRequest(url);
            console.log(`Successfully fetched data from: ${url}`);
            
            // Cache the successful response
            if (url.includes('fees/recommended')) {
                localStorage.setItem('lastKnownFees', JSON.stringify(data));
            } else if (url.includes('fee-rates')) {
                localStorage.setItem(`blockData_${currentTimeWindow}`, JSON.stringify(data));
            }
            
            if (callback && typeof callback === 'function') {
                callback(data);
            }
            
            return data;
        } catch (error) {
            console.error(`Attempt ${i + 1} failed for ${url}:`, error);
            lastError = error;
            
            // Only retry on network-related errors
            if (error.message === 'Failed to fetch' || 
                error.name === 'AbortError' ||
                error.message.includes('network')) {
                
                if (i < retries - 1) {
                    const delay = Math.pow(2, i) * 1000;
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } else {
                break; // Don't retry on non-network errors
            }
        }
    }
    
    // All retries failed or non-network error
    handleFetchError(lastError || new Error(`Failed to fetch from ${url}`));
    throw lastError || new Error(`Failed to fetch from ${url}`);
}

// Improve the handleFetchError function to set offline mode when appropriate
function handleFetchError(error) {
    console.error('Fetch Error:', error);
    const statusElement = document.getElementById('status');
    
    // Check if the error is due to being offline
    if (!navigator.onLine || 
        error.message === 'Failed to fetch' || 
        error.message.includes('network') ||
        error.message === 'In offline mode') {
        
        // Set offline mode flag to prevent repeated fetch attempts
        isOfflineMode = true;
        displayOfflineMessage();
    } else {
        if (statusElement) {
            // Show more specific error message
            if (error.message.includes('JSON')) {
                statusElement.textContent = 'Error: Invalid data received from server';
            } else if (error.message.includes('timeout')) {
                statusElement.textContent = 'Server response timeout. Using cached data...';
                // Set temporary offline mode after multiple timeouts
                isOfflineMode = true;
                setTimeout(() => {
                    console.log('Attempting to exit offline mode after timeout');
                    isOfflineMode = false;
                }, 30000); // Try again after 30 seconds
            } else {
                statusElement.textContent = 'An error occurred while fetching data';
            }
        }
        
        // Try to use cached data when fetch fails
        const storedFees = localStorage.getItem('lastKnownFees');
        if (storedFees) {
            try {
                const parsedData = JSON.parse(storedFees);
                displayFeeRates(parsedData);
                if (statusElement) {
                    statusElement.textContent += ' (using cached data)';
                }
            } catch (e) {
                console.error('Error parsing cached data:', e);
            }
        }
    }
}

// Improve offline message display
function displayOfflineMessage() {
    const statusElement = document.getElementById('status');
    if (statusElement) statusElement.textContent = 'Offline Mode: Using cached data';
    
    // Use fee data from localStorage
    const storedFees = localStorage.getItem('lastKnownFees');
    if (storedFees) {
        try {
            displayFeeRates(JSON.parse(storedFees));
        } catch (e) {
            console.error('Error parsing stored fees:', e);
        }
    } 
    // If no localStorage fee data, use chrome.storage
    else {
        chrome.storage.local.get('feeData', result => {
            if (result.feeData) {
                displayFeeRates(result.feeData);
            } else {
                if (statusElement) statusElement.textContent = 'Offline: No cached data available';
            }
        });
    }
    
    // Handle Bitcoin price in offline mode
    const storedBitcoinPrice = localStorage.getItem('lastBitcoinPrice');
    if (storedBitcoinPrice) {
        try {
            const data = JSON.parse(storedBitcoinPrice);
            displayCachedBitcoinPrice(data);
        } catch (e) {
            console.error('Error parsing cached Bitcoin price data:', e);
        }
    }
    
    // Load cached chart data for current time window
    loadCachedChartData();
    
    // Also cancel any existing fetch intervals
    if (window.fetchIntervalId) {
        clearInterval(window.fetchIntervalId);
        window.fetchIntervalId = null;
    }
}

// New function to load cached chart data
function loadCachedChartData() {
    console.log('Loading cached chart data for time window:', currentTimeWindow);
    
    // Try to load cached chart data for the current time window
    const cachedChartData = localStorage.getItem(`blockData_${currentTimeWindow}`);
    if (cachedChartData) {
        try {
            const data = JSON.parse(cachedChartData);
            console.log('Found cached chart data, updating chart');
            processLatestBlockData(data);
        } catch (e) {
            console.error('Error parsing cached chart data:', e);
        }
    } else {
        console.log('No cached chart data found for time window:', currentTimeWindow);
        // Try to load data from other time windows as fallback
        const fallbackWindows = ['24h', '1w', '1m'].filter(w => w !== currentTimeWindow);
        
        for (const window of fallbackWindows) {
            const fallbackData = localStorage.getItem(`blockData_${window}`);
            if (fallbackData) {
                try {
                    const data = JSON.parse(fallbackData);
                    console.log(`Using fallback chart data from ${window}`);
                    processLatestBlockData(data);
                    break;
                } catch (e) {
                    console.error(`Error parsing fallback chart data for ${window}:`, e);
                }
            }
        }
    }
}

// Improved online event handler
async function onOnline() {
    const statusElement = document.getElementById('status');
    if (statusElement) statusElement.textContent = 'Checking network connection...';
    
    try {
        const isReachable = await checkConnectivity();
        
        if (isReachable) {
            console.log('Network connectivity confirmed');
            isOfflineMode = false;
            if (statusElement) statusElement.textContent = 'Online: Fetching latest fee data...';
            
            // Reset failure counts
            resetFailureCount();
            
            // Refresh data
            fetchData();
            
            // Set up periodic fetch again if needed
            if (!window.fetchIntervalId) {
                window.fetchIntervalId = setInterval(fetchData, FETCH_INTERVAL);
            }
        } else {
            console.log('Browser reports online but API is unreachable');
            isOfflineMode = true;
            displayOfflineMessage();
        }
    } catch (error) {
        console.error('Error while checking connectivity:', error);
        isOfflineMode = true;
        displayOfflineMessage();
    }
}

// Add this function to handle offline events
function onOffline() {
  console.log('Browser reports offline');
  isOfflineMode = true;
  displayOfflineMessage();
  // Clear any existing fetch intervals
  if (window.fetchIntervalId) {
    clearInterval(window.fetchIntervalId);
    window.fetchIntervalId = null;
  }
}

// Function to set fee alert
function setFeeAlert() {
    console.log('setFeeAlert function called');
    const thresholdInput = document.getElementById('alertThreshold');
    if (!thresholdInput) {
        console.error('Alert threshold input not found');
        return;
    }
    
    const threshold = parseInt(thresholdInput.value, 10);
    console.log('Threshold value:', threshold);
    
    if (isNaN(threshold) || threshold <= 0) {
        alert('Please enter a valid positive number for the alert threshold');
        return;
    }
    
    feeAlertThreshold = threshold;
    console.log('Setting fee alert to:', threshold);
    
    // Update UI immediately to show we're processing
    updateAlertUI(threshold);
    
    // Save to browser storage
    try {
        chrome.runtime.sendMessage({
            action: "setFeeAlert",
            threshold: threshold
        }, (response) => {
            console.log('Response from background:', response);
            if (chrome.runtime.lastError) {
                console.error('Chrome runtime error:', chrome.runtime.lastError);
                alert('Error setting alert: ' + chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.success) {
                console.log('Fee alert set successfully');
                // Also save locally as backup
                localStorage.setItem('feeAlertThreshold', threshold.toString());
            } else {
                console.error('Failed to set fee alert:', response);
                alert('Failed to set fee alert. Please try again.');
            }
        });
    } catch (error) {
        console.error('Error sending message to background:', error);
        alert('Error communicating with background script');
    }
}

// Function to clear fee alert
function clearFeeAlert() {
    console.log('clearFeeAlert function called');
    feeAlertThreshold = null;
    
    // Update UI immediately
    updateAlertUI(null);
    
    // Clear from browser storage
    try {
        chrome.runtime.sendMessage({
            action: "clearFeeAlert"
        }, (response) => {
            console.log('Clear alert response:', response);
            if (chrome.runtime.lastError) {
                console.error('Chrome runtime error:', chrome.runtime.lastError);
                alert('Error clearing alert: ' + chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.success) {
                console.log('Fee alert cleared successfully');
                // Also clear locally
                localStorage.removeItem('feeAlertThreshold');
            } else {
                console.error('Failed to clear fee alert:', response);
                alert('Failed to clear fee alert. Please try again.');
            }
        });
    } catch (error) {
        console.error('Error sending clear message to background:', error);
        alert('Error communicating with background script');
    }
}

// Function to update alert UI
function updateAlertUI(threshold) {
    console.log('Updating alert UI with threshold:', threshold);
    const currentAlertElement = document.getElementById('currentAlert');
    const alertStatus = document.getElementById('alertStatus');
    
    if (currentAlertElement) {
        if (threshold) {
            currentAlertElement.textContent = `${threshold} sat/vB`;
            console.log('Updated current alert display to:', threshold);
        } else {
            currentAlertElement.textContent = 'None';
            console.log('Cleared current alert display');
        }
    } else {
        console.error('currentAlert element not found');
    }
    
    if (alertStatus) {
        if (threshold) {
            alertStatus.textContent = 'Active';
            alertStatus.className = 'alert-active';
            console.log('Set alert status to active');
        } else {
            alertStatus.textContent = 'Inactive';
            alertStatus.className = 'alert-inactive';
            console.log('Set alert status to inactive');
        }
    } else {
        console.error('alertStatus element not found');
    }
}

// Function to load alert settings
function loadAlertSettings() {
    console.log('Loading alert settings...');
    
    // Try chrome storage first
    chrome.storage.local.get(['feeAlertThreshold'], (result) => {
        if (chrome.runtime.lastError) {
            console.error('Error loading from chrome storage:', chrome.runtime.lastError);
            // Fallback to localStorage
            const localThreshold = localStorage.getItem('feeAlertThreshold');
            if (localThreshold) {
                const threshold = parseInt(localThreshold, 10);
                if (!isNaN(threshold)) {
                    feeAlertThreshold = threshold;
                    updateAlertUI(threshold);
                    // Also update the input field
                    const thresholdInput = document.getElementById('alertThreshold');
                    if (thresholdInput) {
                        thresholdInput.value = threshold;
                    }
                    console.log('Loaded threshold from localStorage:', threshold);
                }
            }
            return;
        }
        
        if (result.feeAlertThreshold) {
            feeAlertThreshold = result.feeAlertThreshold;
            updateAlertUI(feeAlertThreshold);
            // Also update the input field
            const thresholdInput = document.getElementById('alertThreshold');
            if (thresholdInput) {
                thresholdInput.value = feeAlertThreshold;
            }
            console.log('Loaded threshold from chrome storage:', feeAlertThreshold);
        } else {
            console.log('No saved alert threshold found');
        }
    });
}

// Function to display fee rates
function displayFeeRates(data) {
  console.log('Displaying fee rates:', data); // Debugging log

  // Validate data
  if (!data || typeof data !== 'object') {
    console.error('Invalid fee data received:', data);
    return;
  }

  const fastestFeeElement = document.getElementById('fastestFeeValue');
  const halfHourFeeElement = document.getElementById('halfHourFeeValue');
  const hourFeeElement = document.getElementById('hourFeeValue');
  const minimumFeeElement = document.getElementById('minimumFeeValue');

  // Update element if it exists and data is valid
  if (fastestFeeElement && data.fastestFee !== undefined) {
    fastestFeeElement.textContent = `${data.fastestFee} sat/vB`;
    
    // Add a visual indicator that data has been updated
    fastestFeeElement.classList.add('updated');
    setTimeout(() => {
      fastestFeeElement.classList.remove('updated');
    }, 500);
  } else {
    console.error('Fastest fee data is missing or invalid:', data);
  }

  if (halfHourFeeElement && data.halfHourFee !== undefined) {
    halfHourFeeElement.textContent = `${data.halfHourFee} sat/vB`;
  }

  if (hourFeeElement && data.hourFee !== undefined) {
    hourFeeElement.textContent = `${data.hourFee} sat/vB`;
  }

  if (minimumFeeElement && data.minimumFee !== undefined) {
    minimumFeeElement.textContent = `${data.minimumFee} sat/vB`;
  }

  // Cache the data for offline use
  try {
    localStorage.setItem('lastKnownFees', JSON.stringify(data));
  } catch (e) {
    console.error('Error caching fee data:', e);
  }

  // Store the data for potential alerts
  checkForAlerts(data);
}

// Fix BTC price element ID for display
function displayCachedBitcoinPrice(data) {
    const btcPriceElement = document.getElementById('btcPriceValue');
    const btcPriceChangeElement = document.getElementById('btcPriceChange');
    
    if (btcPriceElement && data.USD) {
        btcPriceElement.textContent = `$${data.USD.toLocaleString()}`;
    }
    
    if (btcPriceChangeElement && data.USDChange) {
        const change = data.USDChange;
        const isPositive = change >= 0;
        btcPriceChangeElement.textContent = `${isPositive ? '+' : ''}${change.toFixed(2)}%`;
        btcPriceChangeElement.className = isPositive ? 'price-up' : 'price-down';
    }
}

function displayBitcoinPrice(data) {
    if (!data || !data.USD) {
        console.error('Invalid Bitcoin price data:', data);
        return;
    }
    
    // Calculate price change if we have previous data
    let priceChange = 0;
    if (lastBitcoinPrice !== null) {
        priceChange = ((data.USD - lastBitcoinPrice) / lastBitcoinPrice) * 100;
    }
    
    // Store current price for next comparison
    lastBitcoinPrice = data.USD;
    bitcoinPriceChange = priceChange;
    
    // Save to localStorage for offline use
    localStorage.setItem('lastBitcoinPrice', JSON.stringify({
        USD: data.USD,
        USDChange: priceChange,
        timestamp: Date.now()
    }));
    
    // Display the price
    displayCachedBitcoinPrice({
        USD: data.USD,
        USDChange: priceChange
    });
}

// Function to check for fee alerts
function checkForAlerts(data) {
    if (!feeAlertThreshold || !data.fastestFee) return;
    
    // Check if the current fastest fee is at or above the threshold
    if (data.fastestFee >= feeAlertThreshold) {
        // Show notification if the browser supports it
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Bitcoin Fee Alert", {
                body: `Current fee (${data.fastestFee} sat/vB) has reached your alert threshold of ${feeAlertThreshold} sat/vB`,
                icon: "icon.png"
            });
        }
        
        // Also show an alert in the UI
        const alertElement = document.getElementById('alertIndicator');
        if (alertElement) {
            alertElement.style.display = 'block';
            
            // Auto-hide after 10 seconds
            setTimeout(() => {
                alertElement.style.display = 'none';
            }, 10000);
        }
    }
}

// Function to fetch data for chart
async function fetchDataForChart() {
    try {
        console.log('Fetching data for chart...');
        const data = await fetchFromEndpoints();
        updateChart(data);
    } catch (error) {
        console.error('Error fetching data for chart:', error);

        // Use cached data as a fallback
        const cachedData = localStorage.getItem('lastKnownFees');
        if (cachedData) {
            console.log('Using cached data for chart:', cachedData);
            updateChart(JSON.parse(cachedData));
        } else {
            console.error('No cached data available for chart');
        }
    }
}

// Make sure to clean up when popup closes
window.addEventListener('beforeunload', () => {
    if (window.fetchIntervalId) {
        clearInterval(window.fetchIntervalId);
        window.fetchIntervalId = null;
    }
});
