// API key for Alpha Vantage
const API_KEY = 'XXXXXXXXX';

// Simulation settings
const FORECAST_DAYS = 30;       // Number of days to simulate
const NUM_SIMULATIONS = 15000;  // Number of sims

//my elements
const commoditySelect = document.getElementById('commodity'); // Dropdown for commodity selection
const runBtn = document.getElementById('run-btn');            // Button to start simulation
const loadingDiv = document.getElementById('loading');       // Loading spinner
const errorDiv = document.getElementById('error');           // Error messages
const resultsSection = document.getElementById('results-section'); // Results container
const chartContainer = document.getElementById('chart-container'); // Interactive histogram container
const tooltip = document.getElementById('tooltip');          // hover info

// API mapping for commodities (from documentation)
const commodityMapping = {
    'COPPER': { function: 'COPPER', interval: 'monthly' },
    'WTI': { function: 'WTI', interval: 'monthly' },
    'ALUMINUM': { function: 'ALUMINUM', interval: 'monthly' }
};


//when clicking button
runBtn.addEventListener('click', async () => {
    const symbol = commoditySelect.value;
    await runAnalysis(symbol);
});

// MAIN ANALYSIS FUNCTION

async function runAnalysis(symbol) {
    // Show loading spinner
    loadingDiv.classList.add('active');
    errorDiv.classList.remove('active');      // hide previous errors
    resultsSection.classList.remove('active'); // hide previous results
    runBtn.disabled = true;                   // prevent multiple clicks

    try {
        // 1. Fetch historical prices
        const prices = await fetchCommodityData(symbol);

        // 2. Run Monte Carlo simulation
        const results = runMonteCarloSimulation(prices);

        // 3. Display results in histogram
        displayResults(results);
    } catch (err) {
        showError(err.message); // Display error message (if there is one)
    } finally {
        // Hide loading spinner & re-enable button
        loadingDiv.classList.remove('active');
        runBtn.disabled = false;
    }
}


// FETCH HISTORICAL DATA

async function fetchCommodityData(symbol) {
    const cacheKey = `commodity_${symbol}`;

    // Try using cached data first (so i dont run out of api calls of 25/day)
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        const parsedCache = JSON.parse(cached);
        const cacheAge = Date.now() - parsedCache.timestamp;

        if (cacheAge < 24 * 60 * 60 * 1000) { // 24 hours cache 
            console.log('Using cached data for', symbol); //tests if im actually using cached data
            return parsedCache.prices;
        }
    }

    //make sure it exists 
    const mapping = commodityMapping[symbol];
    if (!mapping) throw new Error(`Unknown commodity: ${symbol}`);

    // API URL AND FETCHING
    const url = `https://www.alphavantage.co/query?function=${mapping.function}&interval=${mapping.interval}&apikey=${API_KEY}`;
    console.log('Fetching new data for', symbol);

    const response = await fetch(url);
    const data = await response.json();

    // Error handling
    if (data['Error Message']) throw new Error('Invalid symbol');
    if (data['Note']) throw new Error('API rate limit reached. Please wait a minute.');
    if (!data['data']) throw new Error('No data returned');

    // Process data
    const sortedData = data['data'].sort((a, b) => new Date(a.date) - new Date(b.date));
    const prices = sortedData.map(item => parseFloat(item.value));

    //more error handling
    if (prices.length < 30) throw new Error('Not enough historical data');

    const finalPrices = prices.slice(-100); // Use last 100 prices for analysis

    // Cache in local Storage
    localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        prices: finalPrices
    }));

    return finalPrices;
}

// MONTE CARLO SIMULATION

function runMonteCarloSimulation(prices) {
    // 1. Calculate daily returns (todays price-yesterday price)/(yesterdays price)
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    // 2. Calculate average return and volatility. Add up all daily returns and divide number of days. For volatility, (return-average)^2 and take the average of all those and ^2,
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);

    // 3. Run simulations
    const startPrice = prices[prices.length - 1];
    const finalPrices = [];

    for (let sim = 0; sim < NUM_SIMULATIONS; sim++) {
        let price = startPrice;

        for (let day = 0; day < FORECAST_DAYS; day++) {
            const randomReturn = boxMullerRandom(avgReturn, volatility);
            price = price * (1 + randomReturn);
        }

        finalPrices.push(price);
    }

    finalPrices.sort((a, b) => a - b); // sort for percentile calculations

    return { startPrice, finalPrices };
}

//turn into bell curve 
function boxMullerRandom(mean, stdDev) {
    let u1 = Math.random();
    let u2 = Math.random();

    while (u1 === 0) u1 = Math.random(); // prevent log(0)

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
}


// DISPLAY RESULTS

function displayResults(results) {
    // Show current price
    document.getElementById('current-price').textContent = `$${results.startPrice.toFixed(2)}`;

    // Calculate expected price (average of final outcomes)
    const expectedPrice = results.finalPrices.reduce((sum, p) => sum + p, 0) / results.finalPrices.length;
    document.getElementById('expected-price').textContent = `$${expectedPrice.toFixed(2)}`;

    // Best and worst case (percentiles)
    const bestCase = results.finalPrices[Math.floor(results.finalPrices.length * 0.95)];
    const worstCase = results.finalPrices[Math.floor(results.finalPrices.length * 0.05)];
    document.getElementById('best-case').textContent = `$${bestCase.toFixed(2)}`;
    document.getElementById('worst-case').textContent = `$${worstCase.toFixed(2)}`;

    // Draw interactive histogram
    drawHistogram(results);

    // Show results section and scroll
    resultsSection.classList.add('active');
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}


//histogram
function drawHistogram(results, numBins = 20) {
    // Clear previous chart
    chartContainer.innerHTML = '';

    const prices = results.finalPrices;
    const totalSimulations = prices.length;

    // 1. Determine min, max, and bin width
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const binWidth = (maxPrice - minPrice) / numBins;

    // 2. Count prices in each bin
    const bins = new Array(numBins).fill(0);
    prices.forEach(price => {
        const idx = Math.min(Math.floor((price - minPrice) / binWidth), numBins - 1);
        bins[idx]++;
    });

    const maxCount = Math.max(...bins);

    // 3. Create bars with hover tooltips
    bins.forEach((count, i) => {
        const bar = document.createElement('div');
        bar.classList.add('bar');
        bar.style.height = `${(count / maxCount) * 100}%`;      // proportional height
        bar.style.width = `${100 / numBins}%`;                  // equal width
        bar.style.marginRight = '1px';

        // Tooltip hover events
        bar.addEventListener('mouseenter', e => {
            const percent = ((count / totalSimulations) * 100).toFixed(2);
            tooltip.innerHTML = `Simulations: ${count}<br>Percentage: ${percent}%`;
            tooltip.style.display = 'block';
            tooltip.style.left = `${e.pageX + 10}px`;
            tooltip.style.top = `${e.pageY - 30}px`;
        });

        bar.addEventListener('mousemove', e => {
            tooltip.style.left = `${e.pageX + 10}px`;
            tooltip.style.top = `${e.pageY - 30}px`;
        });

        bar.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });

        chartContainer.appendChild(bar);
    });
}


// ERROR HANDLING

function showError(message) {
    errorDiv.textContent = `Error: ${message}`;
    errorDiv.classList.add('active');
}
