const FETCH_INTERVAL = 5000; // Increased frequency of checks to every 5 seconds
const API_URLS = {
    RECOMMENDED_FEES: 'https://mempool.space/api/v1/fees/recommended',
    LAST_24H_BLOCKS: 'https://mempool.space/api/v1/mining/blocks/fee-rates/24h',
    LAST_1W_BLOCKS: 'https://mempool.space/api/v1/mining/blocks/fee-rates/1w',
    LAST_1M_BLOCKS: 'https://mempool.space/api/v1/mining/blocks/fee-rates/1m',
    BLOCKS: 'https://mempool.space/api/v1/blocks',
    BTC_PRICE: 'https://mempool.space/api/v1/prices'
};

let lastBlockHeight = null;
let lastBlockTimestamp = null;
let myChart = null;
let currentTimeWindow = '24h'; // Default time window
let feeAlertThreshold = null; // Initialize alert state
let lastBitcoinPrice = null;
let bitcoinPriceChange = null;


function init() {
  console.log("Initializing popup...");
  
  const statusElement = document.getElementById('status');
  
  if (!statusElement) {
    console.error('Status element is missing in the DOM');
  } else {
    const lastBlockTimeDisplay = document.createElement('span');
    statusElement.appendChild(lastBlockTimeDisplay);
  }

  // Set up the chart
  setupChart();
  
  // Setup event listeners, fetch data, etc.
  // (rest of your init function)
  
  // Add delay before first fetch to give chart time to initialize
  setTimeout(() => {
    if (navigator.onLine) {
      fetchData();
      updateOnlineStatus();
    } else {
      displayOfflineMessage();
    }
  }, 200);

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
  
  console.log("Popup initialization complete");
}

function updateLastBlockClock(lastBlockTimeDisplay) {
    if (lastBlockTimestamp) {
        const now = new Date();
        const timeDiff = now - lastBlockTimestamp;
        const minutes = Math.floor(timeDiff / 60000);
        const seconds = Math.floor((timeDiff % 60000) / 1000);
        lastBlockTimeDisplay.textContent = `Last Block: ${minutes}m ${seconds}s ago`;
    } else {
        lastBlockTimeDisplay.textContent = 'Last Block: N/A';
    }
}

// Add this to your fetchData function 
function fetchData() {
    if (navigator.onLine) {
        fetchDataFromAPI(API_URLS.RECOMMENDED_FEES, displayFeeRates).catch(handleFetchError);
        fetchDataFromAPI(getCurrentTimeWindowAPI(), processLatestBlockData).catch(handleFetchError);
        fetchDataFromAPI(API_URLS.BTC_PRICE, displayBitcoinPrice).catch(error => {
            console.error('Error fetching BTC price:', error);
            // Try to use cached price data
            const storedBitcoinPrice = localStorage.getItem('lastBitcoinPrice');
            if (storedBitcoinPrice) {
                try {
                    const data = JSON.parse(storedBitcoinPrice);
                    displayCachedBitcoinPrice(data);
                } catch (e) {
                    console.error('Error parsing cached Bitcoin price data:', e);
                }
            }
        });
        
        updateOnlineStatus();
    } else {
        // Already offline
        displayOfflineMessage();
    }
}

// Helper function for displaying cached Bitcoin price
function displayCachedBitcoinPrice(data) {
    const btcPriceValue = document.getElementById('btcPriceValue');
    const btcPriceChange = document.getElementById('btcPriceChange');
    
    if (btcPriceValue && data.price) {
        lastBitcoinPrice = data.price;
        btcPriceValue.textContent = `$${data.price.toLocaleString()}`;
    }
    
    if (btcPriceChange && data.change !== undefined) {
        bitcoinPriceChange = data.change;
        const changeText = data.change.toFixed(2);
        
        if (data.change > 0) {
            btcPriceChange.className = 'price-up';
            btcPriceChange.textContent = `24h: +${changeText}%`;
        } else if (data.change < 0) {
            btcPriceChange.className = 'price-down';
            btcPriceChange.textContent = `24h: ${changeText}%`;
        } else {
            btcPriceChange.className = '';
            btcPriceChange.textContent = `24h: ${changeText}%`;
        }
    }
    
    // Also show this information in chart title
    updateChartTitle();
}

async function fetchDataFromAPI(url, callback) {
    if (!navigator.onLine) {
        displayOfflineMessage();
        return;
    }
    
    try {
        // Add timeout to fetch to avoid long-hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`Failed to fetch data from ${url}`);
        
        // Check if response is valid before parsing JSON
        const text = await response.text();
        if (!text) {
            throw new Error(`Empty response from ${url}`);
        }
        
        // Try to parse JSON safely
        let data;
        try {
            data = JSON.parse(text);
        } catch (jsonError) {
            console.error('JSON parse error:', jsonError);
            throw new Error(`Invalid JSON response from ${url}`);
        }
        
        // Check if data exists and is not null
        if (!data) {
            throw new Error(`Null data response from ${url}`);
        }
        
        console.log('Fetched data from API:', data);
        
        // Cache the data for offline use
        if (url === API_URLS.RECOMMENDED_FEES) {
            localStorage.setItem('lastKnownFees', JSON.stringify(data));
        }
        
        // Only call callback if data is valid
        if (callback && typeof callback === 'function') {
            callback(data);
        }
    } catch (error) {
        // AbortController throws a DOMException when it times out
        if (error.name === 'AbortError') {
            console.error('Request timed out:', url);
            handleFetchError(new Error('Request timed out'));
        } else {
            handleFetchError(error);
        }
    }
}

function processLatestBlockData(data) {
    console.log('Processing latest block data:', data);
    
    // If there's no data or empty array, try to use cached chart data
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('No valid block data, trying to use cached data...');
        const cachedChartData = localStorage.getItem('lastChartData');
        if (cachedChartData) {
            try {
                const parsedData = JSON.parse(cachedChartData);
                if (Array.isArray(parsedData) && parsedData.length > 0) {
                    addBlockDataToChart(parsedData);
                    console.log('Successfully loaded cached chart data');
                    return;
                }
                console.log('Cached chart data is invalid');
            } catch (e) {
                console.error('Error parsing cached chart data:', e);
            }
        }
        console.log('No valid cached chart data available');
        return;
    }
    
    try {
        const blockData = data.map(block => {
            if (!block || typeof block.timestamp !== 'number' || typeof block.avgFee_50 !== 'number') {
                console.error('Invalid block data:', block);
                return null;
            }
            return {
                x: new Date(block.timestamp * 1000),
                y: block.avgFee_50
            };
        }).filter(item => item !== null); // Remove any invalid entries
        
        if (blockData.length === 0) {
            console.error('No valid block data to display');
            return;
        }
        
        // Cache the chart data for offline use
        localStorage.setItem('lastChartData', JSON.stringify(blockData));
        
        addBlockDataToChart(blockData);
    } catch (error) {
        console.error('Error processing block data:', error);
    }
}

function displayFeeRates(data) {
    if (!data) {
        console.error('No fee rate data to display');
        return;
    }
    
    const fastestFeeValue = document.getElementById('fastestFeeValue');
    const halfHourFeeValue = document.getElementById('halfHourFeeValue');
    const hourFeeValue = document.getElementById('hourFeeValue');
    const minimumFeeValue = document.getElementById('minimumFeeValue');

    if (fastestFeeValue && data.fastestFee !== undefined) {
        fastestFeeValue.textContent = `${data.fastestFee} sat/vB`;
    }
    if (halfHourFeeValue && data.halfHourFee !== undefined) {
        halfHourFeeValue.textContent = `${data.halfHourFee} sat/vB`;
    }
    if (hourFeeValue && data.hourFee !== undefined) {
        hourFeeValue.textContent = `${data.hourFee} sat/vB`;
    }
    if (minimumFeeValue && data.minimumFee !== undefined) {
        minimumFeeValue.textContent = `${data.minimumFee} sat/vB`;
    }

    localStorage.setItem('lastKnownFees', JSON.stringify(data));
    
    // Check alert condition with the new data
    checkAlertCondition();
}

function handleFetchError(error) {
    console.error('Fetch Error:', error);
    const statusElement = document.getElementById('status');
    
    // Check if the error is due to being offline
    if (!navigator.onLine || error.message === 'Failed to fetch') {
        displayOfflineMessage();
    } else {
        if (statusElement) {
            // Show more specific error message
            if (error.message.includes('JSON')) {
                statusElement.textContent = 'Error: Invalid data received from server';
            } else if (error.message.includes('timeout')) {
                statusElement.textContent = 'Server response timeout. Trying again...';
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

function displayOfflineMessage() {
    const statusElement = document.getElementById('status');
    if (statusElement) statusElement.textContent = 'Offline: Using cached data';
    
    // Use fee data from localStorage
    const storedFees = localStorage.getItem('lastKnownFees');
    if (storedFees) {
        displayFeeRates(JSON.parse(storedFees));
    } 
    // If no localStorage fee data, use chrome.storage
    else {
        chrome.storage.local.get('feeData', result => {
            if (result.feeData) {
                displayFeeRates(result.feeData);
                if (statusElement) statusElement.textContent = 'Offline: Using cached data';
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
}

function onOffline() {
    displayOfflineMessage();
}

function onOnline() {
    const statusElement = document.getElementById('status');
    if (statusElement) statusElement.textContent = 'Online: Fetching latest fee data...';
    fetchData();
}

function updateOnlineStatus() {
    const lastBlockTimeDisplay = document.querySelector('#status span');
    if (navigator.onLine) {
        fetch(API_URLS.BLOCKS)
            .then(response => response.json())
            .then(data => {
                console.log('Fetched block data:', data);
                const lastBlock = data[0];
                if (lastBlock && lastBlock.timestamp) {
                    lastBlockTimestamp = new Date(lastBlock.timestamp * 1000);
                    if (lastBlockTimeDisplay) lastBlockTimeDisplay.textContent = `Last Block: ${formatTimeAgo(lastBlockTimestamp)}`;
                    if (lastBlockHeight !== lastBlock.height) {
                        fetchDataFromAPI(getCurrentTimeWindowAPI(), processLatestBlockData).catch(handleFetchError);
                        lastBlockHeight = lastBlock.height;
                    }
                } else {
                    console.error('Invalid block data:', lastBlock);
                    if (lastBlockTimeDisplay) lastBlockTimeDisplay.textContent = 'Error fetching last block time';
                }
            })
            .catch(error => {
                console.error("Error fetching block timestamp:", error);
                if (lastBlockTimeDisplay) lastBlockTimeDisplay.textContent = 'Error fetching last block time';
            });
    } else {
        if (lastBlockTimeDisplay) lastBlockTimeDisplay.textContent = 'Offline';
    }
}

function formatTimeAgo(lastBlockTimestamp) {
    const now = new Date();
    const timeDiff = now - lastBlockTimestamp;
    const minutes = Math.floor(timeDiff / 60000);
    const seconds = Math.floor((timeDiff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
}

// Replace this function
function setupChart() {
  console.log("Setting up chart from popup.js...");
  
  // First check if canvas exists
  const canvas = document.getElementById('myChart');
  if (!canvas) {
    console.error("Canvas element 'myChart' not found");
    // Create canvas if it doesn't exist
    const chartContainer = document.getElementById('chartContainer');
    if (chartContainer) {
      const newCanvas = document.createElement('canvas');
      newCanvas.id = 'myChart';
      chartContainer.appendChild(newCanvas);
      console.log("Created new canvas element");
    }
  }
  
  if (window.setupChartSafe) {
    const success = window.setupChartSafe();
    if (success) {
      console.log("Chart setup successful");
      // After successful setup, you can reference myChart from window.myChart
      myChart = window.myChart;
    } else {
      console.error("Chart setup failed");
      // Handle the failure case with DOM manipulation instead of innerHTML
      const chartContainer = document.getElementById('chartContainer');
      if (chartContainer) {
        // Clear the container
        while (chartContainer.firstChild) {
          chartContainer.removeChild(chartContainer.firstChild);
        }
        
        // Create new canvas
        const newCanvas = document.createElement('canvas');
        newCanvas.id = 'myChart';
        chartContainer.appendChild(newCanvas);
        
        // Add error message as a separate div
        const errorDiv = document.createElement('div');
        errorDiv.textContent = 'Failed to initialize chart';
        errorDiv.style.color = '#ffa500';
        errorDiv.style.textAlign = 'center';
        errorDiv.style.padding = '5px';
        chartContainer.appendChild(errorDiv);
        
        // Try one more time after a delay
        setTimeout(() => {
          console.log("Retrying chart setup...");
          if (window.setupChartSafe) {
            const retrySuccess = window.setupChartSafe();
            if (retrySuccess) {
              console.log("Chart setup successful on retry");
              myChart = window.myChart;
              
              // Remove error message
              if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
              }
            }
          }
        }, 500);
      }
    }
  } else {
    console.error("setupChartSafe function not available");
  }
}

// Update your addBlockDataToChart function to be more resilient
function addBlockDataToChart(blocks) {
    // First check if we have valid blocks data
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
        console.error("No valid block data to add to chart");
        return;
    }
    
    // If chart is not initialized, try to set it up first
    if (!myChart) {
        console.log("Chart not initialized, attempting to set up...");
        setupChart();
        
        // If still not initialized after setup attempt, try to use window.myChart
        if (!myChart && window.myChart) {
            console.log("Using window.myChart reference");
            myChart = window.myChart;
        }
        
        // If still not initialized, exit
        if (!myChart) {
            console.error("Chart initialization failed, cannot add data");
            return;
        }
    }
    
    try {
        // Safely update chart data - check each property exists before accessing
        if (myChart && myChart.data && myChart.data.datasets && myChart.data.datasets[0]) {
            myChart.data.datasets[0].data = blocks;
            
            // Properly calculate y-axis min and max values
            const values = blocks.map(block => block.y).filter(y => typeof y === 'number' && !isNaN(y));
            if (values.length > 0) {
                const minValue = Math.max(0, Math.min(...values) * 0.8);
                const maxValue = Math.max(...values) * 1.2;
                
                if (myChart.options && myChart.options.scales && myChart.options.scales.y) {
                    myChart.options.scales.y.min = minValue;
                    myChart.options.scales.y.max = maxValue;
                }
            }
            
            // Safely update the chart
            if (typeof myChart.update === 'function') {
                myChart.update();
                console.log("Chart updated with new data");
            }
        } else {
            console.error("Chart object structure is incomplete");
        }
    } catch (error) {
        console.error("Error updating chart:", error);
    }
}

function updateTimeWindow() {
    console.log('Switched to time window:', currentTimeWindow);

    // Update chart time window
    switch (currentTimeWindow) {
        case '24h':
            myChart.options.scales.x.time.unit = 'hour';
            myChart.options.scales.x.time.stepSize = 1;
            break;
        case '1w':
            myChart.options.scales.x.time.unit = 'day';
            myChart.options.scales.x.time.stepSize = 1;
            break;
        case '1m':
            myChart.options.scales.x.time.unit = 'day';
            myChart.options.scales.x.time.stepSize = 2;
            break;
    }

    // Update the dataset label with the new time window
    myChart.data.datasets[0].label = `Fee Rates (sats/vB) - ${currentTimeWindow}`;

    fetchData(); // Fetch new data for the selected time window
    myChart.update();
}

function getCurrentTimeWindowAPI() {
    switch (currentTimeWindow) {
        case '24h':
            return API_URLS.LAST_24H_BLOCKS;
        case '1w':
            return API_URLS.LAST_1W_BLOCKS;
        case '1m':
            return API_URLS.LAST_1M_BLOCKS;
        default:
            return API_URLS.LAST_24H_BLOCKS;
    }
}

// Function to set a fee alert
function setFeeAlert() {
  console.log('Setting fee alert...');
  const thresholdInput = document.getElementById('alertThreshold');
  if (!thresholdInput) {
    console.error('Alert threshold input not found');
    return;
  }
  
  const threshold = parseInt(thresholdInput.value, 10);
  console.log('Alert threshold value:', threshold);
  
  if (isNaN(threshold) || threshold < 1 || threshold > 500) {
    console.error('Invalid threshold value:', threshold);
    alert('Please enter a valid threshold between 1 and 500 sat/vB');
    return;
  }
  
  // Save the alert threshold locally
  feeAlertThreshold = threshold;
  console.log('Setting feeAlertThreshold to:', feeAlertThreshold);
  
  // Save to storage
  chrome.storage.local.set({ feeAlertThreshold }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving to storage:', chrome.runtime.lastError);
    } else {
      console.log('Alert threshold saved to storage');
      
      // Update UI immediately to provide user feedback
      updateCurrentAlertDisplay();
      
      // Then notify background script
      try {
        chrome.runtime.sendMessage({ 
          action: "setFeeAlert", 
          threshold: threshold 
        }, response => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message to background:', chrome.runtime.lastError);
          } else if (response) {
            console.log('Background response:', response);
          }
        });
      } catch (e) {
        console.error('Exception sending message to background:', e);
      }
    }
  });
}

// Function to clear fee alert
function clearFeeAlert() {
    // Clear the alert threshold
    feeAlertThreshold = null;
    chrome.storage.local.remove('feeAlertThreshold');
    
    // Update UI
    updateCurrentAlertDisplay();
    
    // Notify background script to stop checking for alerts
    chrome.runtime.sendMessage({ 
        action: "clearFeeAlert" 
    });
}

// Function to load saved alert settings
function loadAlertSettings() {
    chrome.storage.local.get('feeAlertThreshold', (result) => {
        if (result.feeAlertThreshold) {
            feeAlertThreshold = result.feeAlertThreshold;
            
            // Set the input value to the saved threshold
            const thresholdInput = document.getElementById('alertThreshold');
            if (thresholdInput) thresholdInput.value = feeAlertThreshold;
            
            // Update the current alert display
            updateCurrentAlertDisplay();
        }
    });
}

// Function to update the current alert display
function updateCurrentAlertDisplay() {
    const currentAlertElement = document.getElementById('currentAlert');
    if (!currentAlertElement) return;
    
    if (feeAlertThreshold) {
        // Also update the summary element to show the alert status
        const summaryElement = document.querySelector('.fee-alert-summary');
        if (summaryElement) {
            summaryElement.textContent = `Fee Alerts (${feeAlertThreshold} sat/vB)`;
            
            // Add the dropdown indicator back
            const arrow = document.createElement('span');
            arrow.textContent = document.querySelector('details').open ? '▲' : '▼';
            arrow.style.fontSize = '10px';
            arrow.style.marginLeft = '10px';
            summaryElement.appendChild(arrow);
            
            // Add a class to indicate active alert
            summaryElement.classList.add('alert-active-summary');
        }
        
        // Change text to indicate exact match
        currentAlertElement.textContent = `Alert will trigger when fee is exactly ${feeAlertThreshold} sat/vB`;
        currentAlertElement.classList.add('alert-active');
        
        // Check if current fee is already at threshold
        checkAlertCondition();
    } else {
        // Reset the summary element
        const summaryElement = document.querySelector('.fee-alert-summary');
        if (summaryElement) {
            summaryElement.textContent = 'Fee Alerts';
            
            // Add the dropdown indicator back
            const arrow = document.createElement('span');
            arrow.textContent = document.querySelector('details').open ? '▲' : '▼';
            arrow.style.fontSize = '10px';
            arrow.style.marginLeft = '10px';
            summaryElement.appendChild(arrow);
            
            // Remove the active class
            summaryElement.classList.remove('alert-active-summary');
        }
        
        currentAlertElement.textContent = 'No alerts set';
        currentAlertElement.classList.remove('alert-active');
    }
}

// Function to check if alert condition is met
function checkAlertCondition() {
    if (!feeAlertThreshold) return;
    
    const fastestFeeElement = document.getElementById('fastestFeeValue');
    let currentFee = null;
    
    // Try to get current fee from the DOM first (most up-to-date)
    if (fastestFeeElement) {
        const feeText = fastestFeeElement.textContent;
        const feeMatch = feeText.match(/(\d+)/);
        if (feeMatch && feeMatch[1]) {
            currentFee = parseInt(feeMatch[1], 10);
        }
    }
    
    // If we couldn't get it from DOM, try storage
    if (currentFee === null) {
        chrome.storage.local.get('feeData', (result) => {
            if (result.feeData && result.feeData.fastestFee !== undefined) {
                updateAlertDisplay(result.feeData.fastestFee);
            }
        });
    } else {
        updateAlertDisplay(currentFee);
    }
}

// Helper function to update alert display
function updateAlertDisplay(currentFee) {
    const currentAlertElement = document.getElementById('currentAlert');
    
    if (currentAlertElement) {
        if (currentFee === feeAlertThreshold) {
            // Alert condition met - exact match
            currentAlertElement.textContent = `Match found! Current fee (${currentFee} sat/vB) is exactly at your threshold of ${feeAlertThreshold} sat/vB`;
            currentAlertElement.classList.add('alert-active');
            currentAlertElement.style.fontWeight = 'bold';
        } else {
            // Alert condition not met
            currentAlertElement.textContent = `Alert will trigger when fee is exactly ${feeAlertThreshold} sat/vB (current: ${currentFee} sat/vB)`;
            currentAlertElement.classList.add('alert-active');
        }
    }
}

// Add this debug function
function debugLayoutIssues() {
  console.log("---------- DEBUGGING LAYOUT ISSUES ----------");
  
  // Check which elements exist
  const elements = [
    'chartContainer', 
    'status', 
    'fee-alert-container',
    'setAlertBtn',
    'clearAlertBtn',
    'currentAlert'
  ];
  
  elements.forEach(id => {
    const element = document.getElementById(id) || document.querySelector(`.${id}`);
    console.log(`Element ${id}: ${element ? 'EXISTS' : 'MISSING'}`);
    
    if (element) {
      const rect = element.getBoundingClientRect();
      console.log(`${id} position: top=${rect.top}, height=${rect.height}, visible=${rect.top < window.innerHeight}`);
    }
  });
  
  // Log window dimensions
  console.log(`Window size: ${window.innerWidth} x ${window.innerHeight}`);
  console.log(`Document height: ${document.body.scrollHeight}`);
  console.log(`Scroll position: ${window.scrollY}`);
  
  console.log("----------------------------------------");
}

// Update the displayBitcoinPrice function to use mempool.space API format
function displayBitcoinPrice(data) {
    if (!data || !data.USD) {
        console.error('Invalid Bitcoin price data');
        return;
    }
    
    const btcPriceValue = document.getElementById('btcPriceValue');
    const btcPriceChange = document.getElementById('btcPriceChange');
    
    if (btcPriceValue) {
        lastBitcoinPrice = data.USD;
        btcPriceValue.textContent = `$${data.USD.toLocaleString()}`;
    }
    
    // Calculate 24h change by checking local storage for previous value
    const previousPriceData = localStorage.getItem('lastBitcoinPrice');
    let priceChange = 0;
    
    if (previousPriceData) {
        try {
            const parsedData = JSON.parse(previousPriceData);
            const previousTimestamp = parsedData.timestamp || 0;
            const previousPrice = parsedData.price || 0;
            
            // Only calculate change if we have data that's not too old (less than 25 hours)
            if (previousPrice && (Date.now() - previousTimestamp < 25 * 60 * 60 * 1000)) {
                priceChange = ((data.USD - previousPrice) / previousPrice) * 100;
            }
        } catch (e) {
            console.error('Error parsing previous Bitcoin price data:', e);
        }
    }
    
    if (btcPriceChange) {
        bitcoinPriceChange = priceChange;
        const changeText = priceChange.toFixed(2);
        
        // Add color based on price change
        if (priceChange > 0) {
            btcPriceChange.className = 'price-up';
            btcPriceChange.textContent = `24h: +${changeText}%`;
        } else if (priceChange < 0) {
            btcPriceChange.className = 'price-down';
            btcPriceChange.textContent = `24h: ${changeText}%`;
        } else {
            btcPriceChange.className = '';
            btcPriceChange.textContent = `24h: ${changeText}%`;
        }
    }
    
    // Store the Bitcoin price data for offline use and future comparison
    localStorage.setItem('lastBitcoinPrice', JSON.stringify({
        price: data.USD,
        change: bitcoinPriceChange,
        timestamp: Date.now()
    }));
    
    // Also show this information in chart title
    updateChartTitle();
}

// Add this function to update the chart title with BTC price
function updateChartTitle() {
    if (myChart && lastBitcoinPrice) {
        // Format the price with thousand separators
        const formattedPrice = lastBitcoinPrice.toLocaleString();
        
        // Update the chart title
        if (myChart.options && myChart.options.plugins) {
            myChart.options.plugins.title = {
                display: true,
                text: `Fee Rates (${currentTimeWindow}) - BTC: $${formattedPrice}`,
                color: '#ffa500',
                font: {
                    size: 12
                }
            };
            
            // Safely update the chart
            if (typeof myChart.update === 'function') {
                myChart.update();
            }
        }
    }
}

// In your setupChartSafe function or in chart-loader.js, update the chart options
function setupChartSafe() {
  // ...existing code...
  
  // Get the canvas context
  const canvas = document.getElementById('myChart');
  if (!canvas) {
    console.error("Canvas element 'myChart' not found");
    return false;
  }
  const ctx = canvas.getContext('2d');

  // Create new chart instance
  window.myChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Fee Rates (sats/vB)',
        data: [],
        borderColor: 'orange',
        backgroundColor: 'rgba(255, 165, 0, 0.2)',
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'hour',
            tooltipFormat: 'MMM dd, HH:mm',
            displayFormats: {
              hour: 'HH:mm'
            }
          },
          ticks: {
            maxTicksLimit: 6
          }
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: 20
        }
      },
      plugins: {
        legend: {
          display: false
        },
        title: {
          display: true,
          text: `Fee Rates (${currentTimeWindow})`,
          color: '#ffa500',
          font: {
            size: 12
          }
        }
      }
    }
  });
  
  // If we already have Bitcoin price data, update the chart title
  updateChartTitle();
  
  // ...existing code...
}

// Add this function to adjust popup height when fee alerts are expanded
function setupDetailsToggle() {
  const details = document.querySelector('.fee-alert-container details');
  if (!details) return;
  
  details.addEventListener('toggle', () => {
    // Force reflow by accessing offsetHeight
    document.body.offsetHeight;
    
    // Additional animation effects can be added here if needed
    console.log('Details toggled:', details.open ? 'open' : 'closed');
  });
}

// Theme toggle functionality
function setupThemeToggle() {
  const toggleBtn = document.getElementById('themeToggle');
  if (!toggleBtn) return;
  
  // Check if a theme preference is stored
  chrome.storage.local.get('theme', (result) => {
    if (result.theme === 'light') {
      document.body.classList.add('light-mode');
    }
  });
  
  toggleBtn.addEventListener('click', () => {
    const isLightMode = document.body.classList.toggle('light-mode');
    
    // Save the theme preference
    chrome.storage.local.set({ theme: isLightMode ? 'light' : 'dark' });
    
    // Force a redraw of the chart if it exists
    if (window.feeChart) {
      setTimeout(() => {
        window.feeChart.update();
      }, 100);
    }
  });
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // If Chart.js is already loaded, initialize immediately
    if (window.chartLibrariesLoaded) {
        init();
    }
    // Otherwise, chart-loader.js will call init once libraries are loaded
});
