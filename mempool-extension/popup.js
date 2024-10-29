document.addEventListener('DOMContentLoaded', init);

const FETCH_INTERVAL = 10000;
const API_URLS = {
    RECOMMENDED_FEES: 'https://mempool.space/api/v1/fees/recommended',
    LAST_144_BLOCKS: 'https://mempool.space/api/v1/mining/blocks/fee-rates/24h',
    BLOCKS: 'https://mempool.space/api/v1/blocks'
};

let lastBlockHeight = null;
let lastBlockTimestamp = null;
let myChart = null;

function init() {
    const feesElement = document.getElementById('fastestFeeRate');
    const statusElement = document.getElementById('status');
    const lastBlockTimeDisplay = document.createElement('span');

    if (!feesElement || !statusElement) {
        console.error('One or more elements are missing in the DOM. Please check your HTML.');
        return;
    }

    statusElement.appendChild(lastBlockTimeDisplay);
    setupChart();

    if (navigator.onLine) {
        fetchData();
        updateOnlineStatus();
    } else {
        displayOfflineMessage();
    }

    setInterval(fetchData, FETCH_INTERVAL);
    setInterval(updateLastBlockClock, 1000, lastBlockTimeDisplay); // Update the clock every second
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', displayOfflineMessage);
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

function fetchData() {
    if (navigator.onLine) {
        fetchDataFromAPI(API_URLS.RECOMMENDED_FEES, displayFeeRates).catch(handleFetchError);
        fetchDataFromAPI(API_URLS.LAST_144_BLOCKS, processLatestBlockData).catch(handleFetchError);
        updateOnlineStatus();
    }
}

async function fetchDataFromAPI(url, callback) {
    if (!navigator.onLine) {
        displayOfflineMessage();
        return;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch data from ${url}`);
        const data = await response.json();
        console.log('Fetched data from API:', data);
        callback(data);
    } catch (error) {
        handleFetchError(error);
    }
}

function processLatestBlockData(data) {
    console.log('Processing latest block data:', data);
    const blockData = data.map(block => ({
        x: new Date(block.timestamp * 1000),
        y: block.avgFee_50
    }));
    addBlockDataToChart(blockData);
}

function displayFeeRates(data) {
    document.getElementById('fastestFeeValue').textContent = `${data.fastestFee} sat/vB`;
    document.getElementById('halfHourFeeValue').textContent = `${data.halfHourFee} sat/vB`;
    document.getElementById('hourFeeValue').textContent = `${data.hourFee} sat/vB`;
    document.getElementById('minimumFeeValue').textContent = `${data.minimumFee} sat/vB`;
    localStorage.setItem('lastKnownFees', JSON.stringify(data));
}

function handleFetchError(error) {
    console.error('Fetch Error:', error);
    document.getElementById('status').textContent = 'An error occurred while fetching data.';
}

function displayOfflineMessage() {
    const statusElement = document.getElementById('status');
    statusElement.textContent = 'Offline: Unable to fetch fee data. Showing last known data if available.';
    const storedFees = localStorage.getItem('lastKnownFees');
    if (storedFees) {
        displayFeeRates(JSON.parse(storedFees));
    }
}

function onOnline() {
    document.getElementById('status').textContent = 'Online: Fetching latest 24 hours of fee data...';
    fetchData();
}

function updateOnlineStatus() {
    const lastBlockTimeDisplay = document.querySelector('#status span');
    if (navigator.onLine) {
        fetch(API_URLS.BLOCKS)
            .then(response => response.json())
            .then(data => {
                const lastBlock = data[0];
                lastBlockTimestamp = new Date(lastBlock.timestamp * 1000);
                lastBlockTimeDisplay.textContent = `Last Block: ${formatTimeAgo(lastBlockTimestamp)}`;
                if (lastBlockHeight !== lastBlock.height) {
                    fetchDataFromAPI(API_URLS.LAST_144_BLOCKS, processLatestBlockData).catch(handleFetchError);
                    lastBlockHeight = lastBlock.height;
                }
            })
            .catch(error => {
                console.error("Error fetching block timestamp:", error);
                lastBlockTimeDisplay.textContent = 'Error fetching last block time';
            });
    } else {
        lastBlockTimeDisplay.textContent = 'Offline';
    }
}

function formatTimeAgo(lastBlockTimestamp) {
    const now = new Date();
    const timeDiff = now - lastBlockTimestamp;
    const minutes = Math.floor(timeDiff / 60000);
    const seconds = Math.floor((timeDiff % 60000) / 1000);
    return `${minutes}m ${seconds}s ago`;
}

function setupChart() {
    const ctx = document.getElementById('myChart').getContext('2d');
    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Fee Rates (sats/vB)',
                data: [],
                borderColor: 'orange', // Customize the line color here
                backgroundColor: 'rgba(0, 100, 0, 0.5)', // Customize the fill color here
                borderWidth: 1,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: 'orange', // Customize the point color here
                pointRadius: 2, // Smaller point radius
                pointHoverRadius: 3 // Smaller hover radius
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

function addBlockDataToChart(blocks) {
    console.log('Adding block data to chart:', blocks);

    if (blocks.length > 1) {
        myChart.data.labels = [];
        myChart.data.datasets[0].data = [];
    }

    blocks.forEach(block => {
        const blockTimestamp = block.x;
        const blockFeeInSatsPerVB = block.y;

        if (blockFeeInSatsPerVB && !isNaN(blockFeeInSatsPerVB)) {
            myChart.data.labels.push(blockTimestamp);
            myChart.data.datasets[0].data.push(parseFloat(blockFeeInSatsPerVB.toFixed(2)));
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
    console.log('Chart updated with new data:', myChart.data);
}
