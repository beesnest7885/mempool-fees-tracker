console.log('Chart loader initializing...');

// Global variables to track chart initialization state
window.chartLibrariesLoaded = false;
window.chartInitialized = false;

// Function to load script with proper error handling
function loadScript(src) {
  return new Promise((resolve, reject) => {
    console.log(`Loading script: ${src}`);
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    
    script.onload = () => {
      console.log(`Script loaded successfully: ${src}`);
      resolve();
    };
    
    script.onerror = (error) => {
      console.error(`Failed to load script: ${src}`, error);
      reject(new Error(`Failed to load script: ${src}`));
    };
    
    document.head.appendChild(script);
  });
}

// Load Chart.js and dependencies, then initialize the chart
async function initializeChart() {
  try {
    // Check if Chart is already defined (in case we're loading scripts directly in HTML)
    if (typeof Chart !== 'undefined') {
      console.log('Chart.js already loaded');
      window.chartLibrariesLoaded = true;
    } else {
      // Step 1: Load Chart.js main library
      await loadScript('libs/chart.umd.js');
      
      // Step 2: Load adapter for date handling
      await loadScript('libs/chartjs-adapter-date-fns.js');
      
      // Mark libraries as loaded
      window.chartLibrariesLoaded = true;
      console.log('Chart libraries loaded successfully');
    }
    
    // Now that libraries are loaded, initialize the popup with delay
    setTimeout(() => {
      if (typeof init === 'function') {
        console.log('Initializing popup...');
        init();
      } else {
        console.error('Init function not found');
      }
    }, 100);
    
  } catch (error) {
    console.error('Error loading chart libraries:', error);
    const chartContainer = document.getElementById('chartContainer');
    if (chartContainer) {
      // Use DOM manipulation instead of innerHTML to avoid CSP issues
      const errorDiv = document.createElement('div');
      errorDiv.textContent = 'Failed to load chart libraries';
      errorDiv.style.color = '#ffa500';
      errorDiv.style.textAlign = 'center';
      errorDiv.style.padding = '20px';
      
      // Clear the container
      while (chartContainer.firstChild) {
        chartContainer.removeChild(chartContainer.firstChild);
      }
      
      chartContainer.appendChild(errorDiv);
    }
  }
}

// Function to safely setup the chart
function setupChartSafe() {
  if (typeof Chart === 'undefined') {
    console.error('Chart.js is not defined. Libraries not loaded properly.');
    return false;
  }
  
  console.log('Setting up chart...');
  
  // Get the canvas element
  const canvas = document.getElementById('myChart');
  if (!canvas) {
    console.error("Canvas element 'myChart' not found");
    return false;
  }
  
  // Make sure we have a chart container and canvas
  const chartContainer = document.getElementById('chartContainer');
  if (!chartContainer) {
    console.error("Chart container not found");
    return false;
  }
  
  // Ensure canvas is properly sized but don't use direct width/height assignment
  // as it can cause issues with Chart.js sizing
  
  // Get the 2D context
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error("Failed to get 2D context from canvas");
    return false;
  }
  
  try {
    // Safer way to clean up existing chart
    if (window.myChart) {
      try {
        // Check if the chart object has a destroy method before calling it
        if (window.myChart && typeof window.myChart.destroy === 'function') {
          window.myChart.destroy();
        } else {
          console.log('Previous chart instance has no destroy method, creating new one');
        }
      } catch (e) {
        console.log('Error destroying previous chart:', e);
      }
      window.myChart = null;
    }
    
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
          }
        }
      }
    });
    
    window.chartInitialized = true;
    console.log("Chart created successfully");
    return true;
  } catch (error) {
    console.error("Error creating chart:", error);
    return false;
  }
}

// Make setupChartSafe available globally
window.setupChartSafe = setupChartSafe;

// Start loading libraries when DOM is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChart);
} else {
  initializeChart();
}