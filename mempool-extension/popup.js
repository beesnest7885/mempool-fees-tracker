document.addEventListener('DOMContentLoaded', function () {
    const feesElement = document.getElementById('fastestFeeRate');
    const statusElement = document.getElementById('status');
    const lastBlockTimeDisplay = document.createElement('span');
    let lastBlockHeight = null;
    let myChart = null;

    statusElement.appendChild(lastBlockTimeDisplay);

    if (!feesElement || !statusElement) {
        console.error('One or more elements are missing in the DOM. Please check your HTML.');
        return;
    }

    setupChart(); // Initialize the chart

    // Check if online before fetching data
    if (navigator.onLine) {
        fetchRecommendedFees().catch(handleFetchError);
        fetchLatestBlockFeeData().catch(handleFetchError);
        updateOnlineStatus();
    } else {
        displayOfflineMessage();
    }

    // Set up intervals for periodic updates only if online
    if (navigator.onLine) {
        setInterval(fetchRecommendedFees, 10000); // Every 10 seconds
        setInterval(fetchLatestBlockFeeData, 600000); // Every 10 minutes
        setInterval(updateOnlineStatus, 10000); // Every 10 seconds
    }

    // Add event listeners for online/offline status changes
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', displayOfflineMessage);

    function setupChart() {
        if (typeof Chart === 'undefined') {
            console.error('Chart.js is not loaded yet!');
            return;
        }
        const ctx = document.getElementById('myChart').getContext('2d');
        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Fee Rates (sats/vB)',
                    data: [],
                    borderColor: 'orange', 
                    backgroundColor: 'rgba(255, 165, 0, 0.2)', 
                    borderWidth: 1,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: 'orange'
                }]
            },
            options: {
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'hour',
                            tooltipFormat: 'MMM dd, HH:mm',
                            displayFormats: {
                                hour: 'MMM dd, HH:mm'
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        min: 0,
                        max: 24,
                    }
                }
            }
        });
    }

    async function fetchRecommendedFees() {
        if (!navigator.onLine) {
            displayOfflineMessage();
            return;
        }
        try {
            const response = await fetch('https://mempool.space/api/v1/fees/recommended');
            if (!response.ok) throw new Error('Failed to fetch recommended fees');
            const data = await response.json();
            localStorage.setItem('lastKnownFees', JSON.stringify(data));
            displayFeeRates(data);
        } catch (error) {
            handleFetchError(error);
        }
    }

    function displayFeeRates(data) {
        document.getElementById('fastestFeeValue').textContent = `${data.fastestFee} sat/vB`;
        document.getElementById('halfHourFeeValue').textContent = `${data.halfHourFee} sat/vB`;
        document.getElementById('hourFeeValue').textContent = `${data.hourFee} sat/vB`;
        document.getElementById('minimumFeeValue').textContent = `${data.minimumFee} sat/vB`;
    }

    chrome.storage.local.get('last144Blocks', function(result) {
        if (result.last144Blocks && result.last144Blocks.length > 0) {
            addBlockDataToChart(result.last144Blocks);
        } else if (navigator.onLine) {
            fetchLast144Blocks().catch(handleFetchError);
        } else {
            displayOfflineMessage();
        }
    });

    async function fetchLatestBlockFeeData() {
        if (!navigator.onLine) {
            displayOfflineMessage();
            return;
        }
        try {
            const response = await fetch('https://mempool.space/api/v1/mining/blocks/fee-rates/24h');
            if (!response.ok) throw new Error('Failed to fetch block data');
            const data = await response.json();
            const latestBlock = data[data.length - 1];
            if (lastBlockHeight !== latestBlock.avgHeight) {
                addBlockDataToChart([latestBlock]);
                lastBlockHeight = latestBlock.avgHeight;
            }
        } catch (error) {
            handleFetchError(error);
        }
    }

    function addBlockDataToChart(blocks) {
        const currentTime = Date.now();
        const twentyFourHoursAgo = currentTime - (24 * 60 * 60 * 1000);
    
        blocks.forEach(block => {
            const blockTimestamp = block.timestamp * 1000;
            if (blockTimestamp >= twentyFourHoursAgo) {
                const blockFeeInSatsPerVB = block.avgFee_50;
                if (blockFeeInSatsPerVB && !isNaN(blockFeeInSatsPerVB)) {
                    myChart.data.labels.push(new Date(blockTimestamp));
                    myChart.data.datasets[0].data.push(parseFloat(blockFeeInSatsPerVB.toFixed(2)));
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

    async function fetchLast144Blocks() {
        if (!navigator.onLine) {
            displayOfflineMessage();
            return;
        }
        try {
            const response = await fetch('https://mempool.space/api/v1/mining/blocks/fee-rates/24h');
            if (!response.ok) throw new Error('Failed to fetch block data');
            const data = await response.json();
            chrome.storage.local.set({ last144Blocks: data });
            addBlockDataToChart(data);
        } catch (error) {
            handleFetchError(error);
        }
    }

    function handleFetchError(error) {
        console.error('Fetch Error:', error);
        statusElement.textContent = 'An error occurred while fetching data.';
    }

    function displayOfflineMessage() {
        statusElement.textContent = 'Offline: Unable to fetch fee data. Showing last known data if available.';
        const storedFees = localStorage.getItem('lastKnownFees');
        if (storedFees) {
            displayFeeRates(JSON.parse(storedFees));
        }
    }

    function onOnline() {
        statusElement.textContent = 'Online: Fetching fee data...';
        fetchRecommendedFees().catch(handleFetchError);
        fetchLatestBlockFeeData().catch(handleFetchError);
        updateOnlineStatus();
    }

    function formatTimeAgo(lastBlockTimestamp) {
        const now = new Date();
        const lastBlock = new Date(lastBlockTimestamp);
        const timeDiff = now - lastBlock;
        const minutes = Math.floor(timeDiff / 60000);
        const seconds = Math.floor((timeDiff % 60000) / 1000);
        return `${minutes}m ${seconds}s ago`;
    }

    function updateOnlineStatus() {
        if (navigator.onLine) {
            fetch('https://mempool.space/api/v1/blocks')
                .then(response => response.json())
                .then(data => {
                    const lastBlock = data[0];
                    lastBlockTimeDisplay.textContent = `Last Block: ${formatTimeAgo(lastBlock.timestamp * 1000)}`;
                })
                .catch(error => {
                    console.error("Error fetching block timestamp:", error);
                    lastBlockTimeDisplay.textContent = 'Error fetching last block time';
                });
        } else {
            lastBlockTimeDisplay.textContent = 'Offline';
        }
    }
});
