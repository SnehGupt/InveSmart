

import { GoogleGenAI } from "@google/genai";

// --- 1. LIVE API & CACHING SERVICES ---

const apiService = {
    BASE_URL: 'https://flaskintrige.onrender.com/api',

    _logoCache: {
        "AAPL": "https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg",
        "MSFT": "https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg",
        "TSLA": "https://upload.wikimedia.org/wikipedia/commons/b/bd/Tesla_Motors.svg",
        "F": "https://upload.wikimedia.org/wikipedia/commons/3/3e/Ford_logo_blue.svg",
        "GM": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/General_Motors_logo.svg/1200px-General_Motors_logo.svg.png",
        "GOOG": "https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg",
        },
    getLogoUrl(ticker) {
        return this._logoCache[ticker] || `https://via.placeholder.com/60x60.png?text=${ticker}`;
    },
    
    _exchangeToTaxInfo: {
        'NASDAQ': { country: 'the US', rate: 0.21 },
        'NYSE': { country: 'the US', rate: 0.21 },
        'BATS': { country: 'the US', rate: 0.21 },
        'OTCMKTS': { country: 'the US', rate: 0.21 },
        'TSX': { country: 'Canada', rate: 0.265 },
        'TSXV': { country: 'Canada', rate: 0.265 },
        'LSE': { country: 'the UK', rate: 0.25 },
        'EURONEXT': { country: 'France', rate: 0.25 },
        'XETRA': { country: 'Germany', rate: 0.30 },
        'JPX': { country: 'Japan', rate: 0.306 },
        'ASX': { country: 'Australia', rate: 0.30 },
    },
    _defaultTaxInfo: { country: 'an estimated region', rate: 0.23 },

    _parseValue(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number') return isFinite(value) ? value : null;
        if (typeof value !== 'string' || value.trim() === '') return null;

        // Handle 'T', 'B', 'M' suffixes.
        const cleanedValue = value.replace(/,/g, '').trim();
        const numPart = parseFloat(cleanedValue);

        if (isNaN(numPart)) return null;

        const lastChar = cleanedValue.slice(-1).toUpperCase();

        if (lastChar === 'T') return numPart * 1e12;
        if (lastChar === 'B') return numPart * 1e9;
        if (lastChar === 'M') return numPart * 1e6;

        return numPart;
    },

    async _handleResponse(response) {
        if (!response.ok) {
            let errorBody = await response.text();
            try {
                const jsonError = JSON.parse(errorBody);
                errorBody = jsonError.error || JSON.stringify(jsonError);
            } catch (e) {
                // Not a JSON error, likely HTML. Strip tags for brevity.
                errorBody = errorBody.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
            }
            throw new Error(errorBody || `HTTP error! status: ${response.status}`);
        }
        const resClone = response.clone();
        const rawText = await resClone.text();
        try {
            return JSON.parse(rawText);
        } catch(e) {
            console.error("Failed to parse JSON:", rawText);
            throw new Error("Invalid JSON response from server.");
        }
    },

    _transformSummaryData(data) {
        const price = this._parseValue(data.currentPrice || data.latestPrice);
        const marketCap = this._parseValue(data.marketCap);
        const revenue = this._parseValue(data.revenue);
        const ebitda = this._parseValue(data.ebitda);
        const shares = marketCap && price ? marketCap / price : null;
        // Simplified net debt assumption. A real model would need more data.
        const netDebt = (ebitda && ebitda > 0) ? marketCap / (ebitda * 0.1) : 5000 * 1e6; 

        let scenarios = [];
        if (data.scenarios && Array.isArray(data.scenarios)) {
            // Deduplicate by ID, as suggested by the provided snippet logic.
            const uniqueScenarios = data.scenarios.filter(
              (s: any, index: number, self: any[]) =>
                index === self.findIndex((t: any) => t.id === s.id)
            );
            scenarios = uniqueScenarios;
        }

        const parsedTaxRate = this._parseValue(data.taxRate);
        let finalTaxRate;
        let taxRateIsAssumed = false;
        let taxRateSource = '';

        if (parsedTaxRate !== null) {
            finalTaxRate = parsedTaxRate / 100; // API value is a percentage, convert to decimal
        } else {
            const exchange = data.exchange?.toUpperCase();
            const taxInfo = this._exchangeToTaxInfo[exchange] || this._defaultTaxInfo;
            finalTaxRate = taxInfo.rate;
            taxRateIsAssumed = true;
            taxRateSource = ` (Assumed for ${taxInfo.country})`;
        }
        
        const psRatio = this._parseValue(data.psRatio);
        const evEbitda = ebitda && ebitda > 0 && marketCap ? marketCap / ebitda : null;
        const pbRatio = this._parseValue(data.pbRatio);
        const roe = this._parseValue(data.roe);


        return {
            ticker: data.ticker,
            companyName: data.companyName,
            exchange: data.exchange,
            logoUrl: data.logoUrl, // <-- ADDED: Extract logoUrl from API response
            price: price,
            previousClose: this._parseValue(data.previousClose),
            open: this._parseValue(data.open),
            change: this._parseValue(data.priceChange),
            changePercent: this._parseValue(data.priceChangePct),
            marketCap: marketCap,
            revenue: revenue,
            ebitda: ebitda,
            peRatio: this._parseValue(data.peRatio),
            revenueGrowth: this._parseValue(data.revenueGrowth) / 100, // Convert to decimal
            taxRate: finalTaxRate,
            taxRateIsAssumed,
            taxRateSource,
            interestRate: 0.085, // Default interest rate
            shares: shares,
            netDebt: netDebt,
            scenarios,
            psRatio,
            evEbitda,
            pbRatio,
            roe: roe ? roe / 100 : null, // convert to decimal
            domain: getTickerDomain(data.ticker),
            // Fix: Cast data.lastUpdated to any to handle potential type inference issues.
            lastUpdated: new Date(data.lastUpdated as any),
        };
    },
    
    async getTickerSummary(ticker, retries = 3, delay = 2000) {
        try {
            const response = await fetch(`${this.BASE_URL}/ticker_summary?ticker=${ticker}`);
            const data = await this._handleResponse(response);
            return this._transformSummaryData(data);
        } catch (error) {
            if (retries > 0) {
                console.warn(`API call for ${ticker} failed. Retrying in ${delay / 1000}s... (${retries - 1} retries left)`);
                await new Promise(res => setTimeout(res, delay));
                return this.getTickerSummary(ticker, retries - 1, delay * 2); // Exponential backoff
            } else {
                console.error(`API call for ${ticker} failed after multiple retries.`);
                throw error; // Re-throw the error after all retries have failed
            }
        }
    },
};

const tickerList = [
    { ticker: "AAPL", name: "Apple Inc." }, { ticker: "MSFT", name: "Microsoft Corp." }, { ticker: "GOOGL", name: "Alphabet Inc. A" }, { ticker: "GOOG", name: "Alphabet Inc. C" },
    { ticker: "AMZN", name: "Amazon.com, Inc." }, { ticker: "NVDA", name: "NVIDIA Corp." }, { ticker: "META", name: "Meta Platforms, Inc." }, { ticker: "TSLA", name: "Tesla, Inc." },
    { ticker: "BRK-B", name: "Berkshire Hathaway" }, { ticker: "LLY", name: "Eli Lilly & Co." }, { ticker: "V", name: "Visa Inc." }, { ticker: "JPM", name: "JPMorgan Chase & Co." },
    { ticker: "WMT", name: "Walmart Inc." }, { ticker: "UNH", name: "UnitedHealth Group" }, { ticker: "XOM", name: "Exxon Mobil Corp." }, { ticker: "MA", name: "Mastercard Inc." },
    { ticker: "JNJ", name: "Johnson & Johnson" }, { ticker: "HD", name: "Home Depot, Inc." }, { ticker: "PG", "name": "Procter & Gamble Co." }, { ticker: "AVGO", name: "Broadcom Inc." },
    { ticker: "ORCL", name: "Oracle Corp." }, { ticker: "COST", name: "Costco Wholesale" }, { ticker: "CVX", name: "Chevron Corp." }, { ticker: "MRK", name: "Merck & Co." },
    { ticker: "ABBV", name: "AbbVie Inc." }, { ticker: "CRM", name: "Salesforce, Inc." }, { ticker: "BAC", name: "Bank of America" }, { ticker: "PEP", name: "PepsiCo, Inc." },
    { ticker: "KO", name: "Coca-Cola Co." }, { ticker: "ADBE", name: "Adobe Inc." }, { ticker: "NFLX", name: "Netflix, Inc." }, { ticker: "AMD", name: "Advanced Micro Devices" },
    { ticker: "DIS", name: "Walt Disney Co." }, { ticker: "MCD", name: "McDonald's Corp." }, { ticker: "CSCO", name: "Cisco Systems" }, { ticker: "INTC", name: "Intel Corp." },
    { ticker: "PFE", name: "Pfizer Inc." }, { ticker: "TMO", name: "Thermo Fisher Scientific" }, { ticker: "NKE", name: "NIKE, Inc." }, { ticker: "WFC", name: "Wells Fargo & Co." },
    { ticker: "CMCSA", name: "Comcast Corp." }, { ticker: "VZ", name: "Verizon Communications" }, { ticker: "T", name: "AT&T Inc." }, { ticker: "IBM", name: "IBM Corp." },
    { ticker: "QCOM", name: "QUALCOMM Inc." }, { ticker: "UBER", name: "Uber Technologies" }, { ticker: "SBUX", name: "Starbucks Corp." }, { ticker: "F", name: "Ford Motor Co."},
    { ticker: "GM", name: "General Motors Co."}, { ticker: "RIVN", name: "Rivian Automotive"}, { ticker: "NIO", name: "NIO Inc."}, { ticker: "LCID", name: "Lucid Group"},
    { ticker: "GS", name: "Goldman Sachs Group" }, { ticker: "MS", name: "Morgan Stanley" }, { ticker: "C", name: "Citigroup Inc." }
];
const peerMap = {
    TSLA: ['GM', 'F', 'RIVN', 'NIO', 'LCID'], 
    AAPL: ['MSFT', 'GOOGL', 'AMZN', 'META'], 
    MSFT: ['AAPL', 'GOOGL', 'AMZN', 'CRM'],
    GOOGL: ['MSFT', 'AAPL', 'META', 'AMZN'],
    AMZN: ['MSFT', 'GOOGL', 'WMT'],
    NVDA: ['AMD', 'INTC', 'QCOM'],
    F: ['GM', 'TSLA', 'RIVN'], 
    GM: ['F', 'TSLA', 'RIVN'], 
    GOOG: ['MSFT', 'AAPL', 'META', 'AMZN'],
    JPM: ['BAC', 'WFC', 'C', 'GS', 'MS'],
    BAC: ['JPM', 'WFC', 'C'],
    WFC: ['JPM', 'BAC', 'C'],
    C: ['JPM', 'BAC', 'WFC'],
    GS: ['MS', 'JPM'],
    MS: ['GS', 'JPM']
};

const TICKER_TO_DOMAIN = {
    // Technology
    'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'GOOG': 'Technology',
    'NVDA': 'Technology', 'META': 'Technology', 'TSLA': 'Technology', 'AVGO': 'Technology',
    'ORCL': 'Technology', 'CRM': 'Technology', 'ADBE': 'Technology', 'NFLX': 'Technology',
    'AMD': 'Technology', 'CSCO': 'Technology', 'INTC': 'Technology', 'QCOM': 'Technology',
    'UBER': 'Technology', 'IBM': 'Technology',
    // Consumer/Retail
    'AMZN': 'Consumer/Retail', 
    'WMT': 'Consumer/Retail', 'LLY': 'Consumer/Retail', 'V': 'Consumer/Retail', 'UNH': 'Consumer/Retail',
    'XOM': 'Consumer/Retail', 'MA': 'Consumer/Retail', 'JNJ': 'Consumer/Retail', 'HD': 'Consumer/Retail',
    'PG': 'Consumer/Retail', 'COST': 'Consumer/Retail', 'CVX': 'Consumer/Retail', 'MRK': 'Consumer/Retail',
    'ABBV': 'Consumer/Retail', 'PEP': 'Consumer/Retail', 'KO': 'Consumer/Retail', 'DIS': 'Consumer/Retail',
    'MCD': 'Consumer/Retail', 'PFE': 'Consumer/Retail', 'TMO': 'Consumer/Retail', 'NKE': 'Consumer/Retail',
    'CMCSA': 'Consumer/Retail', 'VZ': 'Consumer/Retail', 'T': 'Consumer/Retail', 'SBUX': 'Consumer/Retail',
    'F': 'Consumer/Retail', 'GM': 'Consumer/Retail', 'RIVN': 'Consumer/Retail', 'NIO': 'Consumer/Retail',
    'LCID': 'Consumer/Retail',
    // Financials
    'JPM': 'Financials', 'BRK-B': 'Financials', 'BAC': 'Financials', 'WFC': 'Financials',
    'GS': 'Financials', 'MS': 'Financials', 'C': 'Financials',
};
const getTickerDomain = (ticker) => TICKER_TO_DOMAIN[ticker] || 'Technology'; // Default to tech

const DOMAIN_SCENARIOS = {
    'Technology': [
        { id: 'baseCase', name: 'Base Case' },
        { id: 'mezzanineDebt', name: 'Mezzanine Debt' },
        { id: 'ipoExit', name: 'IPO Exit' },
        { id: 'growthEquity', name: 'Growth Equity' },
    ],
    'Consumer/Retail': [
        { id: 'baseCase', name: 'Base Case' },
        { id: 'dividendRecap', name: 'Dividend Recap' },
        { id: 'strategicSale', name: 'Strategic Sale' },
        { id: 'clubDeal', name: 'Club Deal' },
    ],
    'Financials': [
        { id: 'baseCase', name: 'Base Case' },
        { id: 'leveragedRecap', name: 'Leveraged Recap' },
        { id: 'sponsorToSponsorExit', name: 'Sponsor-to-Sponsor Exit' },
        { id: 'managementBuyout', name: 'Management Buyout' },
    ],
};

// --- 2. STATE MANAGEMENT ---
let state = {
    currentView: 'welcome', // 'welcome' or 'dashboard'
    currentTab: 'valuation_models', 
    ticker: 'TSLA',
    welcomeTicker: 'TSLA',
    dashboardData: null, // Will hold { quote, peers, workflow }
    analysisContent: {}, // e.g., { swot: { ticker: "TSLA", content: "..." } }
    pitchDeck: { currentSlide: 0, slides: [] },
    lboScenario: 'baseCase', // New state for LBO scenario
    loading: { data: false, analysis: false, lbo: false },
    error: null,
    peerSort: { column: 'marketCap', direction: 'desc' },
    alert: { target: null, active: false, triggered: false, direction: null },
    showAlertInput: false,
    realtimeStatus: 'connected', // 'connected', 'error', 'connecting'
    theme: localStorage.getItem('banksmart-theme') || 'dark', // 'dark' or 'light'
};
let realtimeIntervalId = null;
let postRenderCallbacks = [];


// --- 3. GEMINI API SERVICE ---
const API_KEY = process.env.API_KEY || "";
let ai;
if(API_KEY) ai = new GoogleGenAI({ apiKey: API_KEY });
const model = 'gemini-2.5-flash';

async function generateAnalysis(ticker, companyName, type) {
    if (!ai) return "API_KEY is not set up. Cannot generate analysis.";
    const prompts = {
        swot: `As a strategy consultant, conduct a SWOT analysis for ${companyName} (${ticker}). Base your findings on current information from financial reports, news articles, and market analysis available on the web. Provide 2-3 distinct points for each category (Strengths, Weaknesses, Opportunities, Threats).`,
        memo: `Act as an investment banking associate. Draft a 1-page investment memo for ${companyName} (${ticker}). Your analysis must be grounded in real-time financial data, recent news, and market sentiment. Include: Company Overview, Investment Thesis, Financial Snapshot, Key Risks & Mitigants, and Exit Strategy.`,
        pitch_deck: `Act as a senior investment banking analyst creating a client-facing pitch deck for ${companyName} (${ticker}) suitable for senior executives.

**Global Instructions:**
- **Layouts:** For every slide, you MUST use a professional corporate slide layout. Instead of text placeholders like "[Visual: ...]", generate the actual data for the visual in a structured format. Use professional tables, charts with data, and diagrams with items.
- **Style:** The tone must be professional, clean, and corporate. The content should be boardroom-ready with a neutral color palette, consistent fonts, and balanced spacing.
- **Conciseness:** Keep each slide concise and visually polished.
- **Formatting:** Generate multiple slides using markdown. Each slide must have a clear title starting with '###'.
- **Consistency:** You **MUST** generate all 9 slides in the specified order. Do not skip slides, even if data is sparse. Populate all chart and diagram data with realistic, company-specific information based on your search capabilities; do not use the placeholder data provided in the examples.

**Required Slides & Visual Formats:**

### 1. ${companyName} (${ticker}) Company Overview
- Generate a clean overview with key facts (HQ, Founded, Employees), business model summary, and market positioning.
- Use a markdown table for the key facts.

### 2. ${companyName} (${ticker}) Public Market Overview & NTM EBITDA Evolution
- Present a dual-axis chart analysis. Provide concise commentary on market trends and performance drivers.
- **MUST** include the chart data in this exact format, replacing placeholder values with realistic data for ${companyName}:
[CHART type="bar-line-combo" title="Revenue & NTM EBITDA Margin Evolution"]
Year,Revenue (USD M),NTM EBITDA Margin (%)
2020,50000,15
2021,55000,16
2022,62000,18
2023,68000,17
2024,75000,19
[/CHART]

### 3. ${companyName} (${ticker}) Stock Price Performance vs Peer
- Show a comparative analysis of stock price performance. Generate *representative, illustrative* data for ${companyName}.
- **MUST** include the chart data in this exact format, replacing placeholder values with realistic data for ${companyName}:
[CHART type="line" title="Stock Price Performance (Normalized)"]
Date,${ticker},Peer Index
Jan 2022,100,100
Jul 2022,110,105
Jan 2023,125,115
Jul 2023,140,120
Jan 2024,155,130
[/CHART]

### 4. Broker Perspectives on ${companyName} (${ticker})
- Summarize broker ratings in a professional markdown table with columns: Broker, Rating, Price Target.
- **MUST** include a sentiment chart data in this exact format, replacing placeholder values with realistic data for ${companyName}:
[CHART type="donut" title="Broker Rating Distribution"]
Rating,Count
Buy,12
Hold,8
Sell,2
[/CHART]

### 5. Trading Multiples
- Create a clean, professional markdown table comparing ${companyName} (${ticker}) to its peers.
- Columns: Company, Scale (Market Cap), Revenue Growth (NTM %), Profitability Margin (NTM EBITDA %), FV/Revenue (NTM), FV/EBITDA (NTM).

### 6. Diagram Showing Growth of ${companyName} (${ticker})
- Illustrate the company's growth trajectory using a diagram.
- **MUST** include the diagram items in this exact format, replacing placeholder items with realistic milestones for ${companyName}:
[DIAGRAM type="timeline"]
2018: Launched flagship product to critical acclaim.
2020: Expanded into European and Asian markets.
2022: Acquired a key technology startup to bolster R&D.
2024: Reached 100 million active users milestone.
[/DIAGRAM]

### 7. ${companyName} (${ticker}) Built Through M&A
- Detail the company's acquisition history. Use a diagram.
- **MUST** include the diagram items in this exact format, replacing placeholder items with realistic M&A history for ${companyName}:
[DIAGRAM type="flow"]
Acquired TechCorp (2019): Gained key AI patents and talent.
Merged with DataLytics (2021): Expanded data analytics capabilities.
Purchased Innovate Inc. (2023): Entered a new adjacent market segment.
[/DIAGRAM]

### 8. ${companyName} (${ticker}) Opportunities to Expand
- Outline potential future growth vectors using a roadmap diagram.
- **MUST** include the diagram items in this exact format, replacing placeholder items with realistic opportunities for ${companyName}:
[DIAGRAM type="roadmap"]
New Markets: Expand operations into Latin America and Africa.
Product Adjacencies: Launch new software suite for enterprise clients.
Strategic Partnerships: Form alliances with major cloud providers.
[/DIAGRAM]

### 9. ${companyName} (${ticker}) Other Companies Overview
- Provide a comparative overview of other key players in the sector using a markdown table.
- Highlight ${companyName} (${ticker})'s key differentiators and competitive positioning.
`,
        news: `Act as a senior financial analyst. Use real-time search data to summarize the most impactful news for ${ticker} from the past month. Focus on earnings, strategic initiatives, and analyst ratings. Format as 3-4 concise bullet points.`,
    };
    const response = await ai.models.generateContent({
        model, contents: prompts[type], config: { tools: [{googleSearch: {}}] },
    });
    return response.text;
}


// --- 4. FORMATTER SERVICE ---
const formatterService = {
    currency(value, precision = 2) {
        if (typeof value !== 'number' || isNaN(value)) return 'N/A';
        const sign = value < 0 ? '-' : '';
        return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision })}`;
    },
    largeNumber(value, isCurrency = true) {
        if (typeof value !== 'number' || isNaN(value)) return 'N/A';
        const prefix = isCurrency ? '$' : '';
        if (Math.abs(value) >= 1e12) { return `${prefix}${(value / 1e12).toFixed(2)}T`; }
        if (Math.abs(value) >= 1e9) { return `${prefix}${(value / 1e9).toFixed(2)}B`; }
        if (Math.abs(value) >= 1e6) { return `${prefix}${(value / 1e6).toFixed(2)}M`; }
        return `${prefix}${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    },
    percent(value, precision = 2) {
        if (typeof value !== 'number' || isNaN(value)) return 'N/A';
        return `${(value * 100).toFixed(precision)}%`;
    },
    ratio(value, suffix = 'x') {
        if (typeof value !== 'number' || isNaN(value)) return 'N/A';
        return `${value.toFixed(2)}${suffix}`;
    }
};

// --- 5. RENDER FUNCTIONS ---

function renderApp() {
    const welcomePage = document.getElementById('welcome-page');
    const dashboardPage = document.getElementById('dashboard-page');
    if (state.currentView === 'welcome') {
        welcomePage.classList.remove('hidden');
        dashboardPage.classList.add('hidden');
        renderWelcomePage();
    } else {
        welcomePage.classList.add('hidden');
        dashboardPage.classList.remove('hidden');
        renderDashboard();
    }
}

function renderWelcomePage() {
    const container = document.getElementById('welcome-page');
    container.innerHTML = `
        <div class="flex justify-center mb-6">
      
    </div>
        <div class="w-full max-w-2xl text-center fade-in z-10 bg-black/40 backdrop-blur-sm p-8 rounded-2xl border border-white/10">
            <div class="typing-effect inline-block">
                <h1 class="text-4xl md:text-5xl font-bold">Pitchly</h1>
            </div>
            <p class="text-lg text-gray-300 mt-2">Empowering junior analysts with real-time insights and modeling tools.</p>
            <div class="mt-8 max-w-md mx-auto">
                <div class="flex gap-2 autocomplete">
                     <input id="welcome-ticker-input" value="${state.welcomeTicker}" type="text" placeholder="e.g., AAPL, TSLA" class="flex-grow bg-gray-900 border-2 border-gray-600 rounded-lg px-5 py-3 placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-amber-500/50 transition-all text-xl text-center font-mono tracking-widest uppercase">
                     <button id="launch-btn" class="animated-launch-btn bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-6 rounded-lg">Launch</button>
                </div>
            </div>
        </div>`;
    addWelcomeEventListeners();
}

function renderDashboard() {
    renderHeader();
    renderNavigation();
    renderContent();
    addDashboardEventListeners();
}

function renderHeader() {
    const container = document.getElementById('header-container');
    const data = state.dashboardData?.quote;
    let content;

    if (state.loading.data) {
        content = `<div class="w-full h-24 flex items-center justify-center glass-panel rounded-xl"><p class="text-gray-400 animate-pulse">Loading data for ${state.ticker.toUpperCase()}...</p></div>`;
    } else if (data) {
        const changeColor = data.change >= 0 ? 'text-green-400' : 'text-red-400';
        const { sentiment, className, emoji } = getSentimentDetails(data.changePercent);
        const sentimentTag = `<div id="sentiment-tag" class="sentiment-tag ${className}">${emoji} ${sentiment}</div>`;
        
        content = `
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 glass-panel p-4 rounded-xl">
            <div class="flex items-center gap-4">
                <img src="${data.logoUrl || apiService.getLogoUrl(data.ticker)}" alt="${data.ticker} logo" class="h-12 w-12 object-contain bg-white/90 p-1 rounded-full" />
                <div>
                    <div class="flex items-center flex-wrap gap-x-3 gap-y-1">
                        <h1 class="text-xl font-bold">${data.companyName} (${data.ticker.toUpperCase()})</h1>
                        ${sentimentTag}
                    </div>
                    <p class="text-sm text-gray-400">${data.exchange}</p>
                </div>
            </div>
            <div id="price-quote" class="text-right font-mono p-2 rounded-md">
                <p id="header-latest-price" class="text-2xl font-bold">${formatterService.currency(data.price)} USD</p>
                <p class="font-semibold ${changeColor}">${formatterService.currency(data.change)} (${formatterService.percent(data.changePercent / 100)})</p>
            </div>
            <div class="flex items-center gap-4">
                ${renderConnectionStatus()}
                ${renderAlertUI()}
                ${renderThemeToggle()}
                <div class="flex items-center gap-2 autocomplete">
                    <input id="ticker-switch-input" type="text" placeholder="Switch Ticker" class="bg-gray-900/50 border border-gray-600 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 w-32 font-mono uppercase">
                    <button id="ticker-switch-btn" class="bg-gray-700 hover:bg-gray-600 font-semibold py-1.5 px-3 rounded-md text-sm">Go</button>
                </div>
            </div>
        </div>`;
    } else {
         content = `<div class="w-full h-24 flex items-center justify-center glass-panel rounded-xl"><p class="text-red-500">${state.error || `Could not load data for ${state.ticker.toUpperCase()}.`}</p></div>`;
    }
    container.innerHTML = content;
}

function renderThemeToggle() {
    const isDark = state.theme === 'dark';
    const title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    const icon = isDark 
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.106a.75.75 0 010 1.06l-1.591 1.59a.75.75 0 11-1.06-1.06l1.59-1.591a.75.75 0 011.06 0zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.803 17.803a.75.75 0 01-1.06 0l-1.59-1.591a.75.75 0 111.06-1.06l1.59 1.59a.75.75 0 010 1.06zM12 21a.75.75 0 01-.75-.75v-2.25a.75.75 0 011.5 0V20.25a.75.75 0 01-.75.75zM6.106 18.894a.75.75 0 011.06 0l1.59-1.59a.75.75 0 111.06 1.06l-1.59 1.591a.75.75 0 01-1.06 0zM3.75 12a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H4.5a.75.75 0 01-.75-.75zM6.106 6.106a.75.75 0 010-1.06l1.59-1.591a.75.75 0 011.06 1.06l-1.59 1.59a.75.75 0 01-1.06 0z" /></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clip-rule="evenodd" /></svg>`;
    return `
        <button id="theme-toggle-btn" title="${title}" class="text-gray-400 hover:text-white transition-colors">
            ${icon}
        </button>
    `;
}

function renderConnectionStatus() {
    const { realtimeStatus } = state;
    let dotClass, text, title;

    switch (realtimeStatus) {
        case 'connected':
            dotClass = 'bg-green-500 animate-pulse';
            text = 'Live';
            title = 'Real-time connection active. Price updates every 30 seconds.';
            break;
        case 'error':
            dotClass = 'bg-red-500';
            text = 'Error';
            title = 'Connection error. Could not fetch real-time data. Retrying automatically.';
            break;
        case 'connecting':
            dotClass = 'bg-yellow-500 animate-pulse';
            text = 'Connecting';
            title = 'Establishing real-time connection...';
            break;
        default:
            dotClass = 'bg-gray-500';
            text = 'Offline';
            title = 'Real-time connection is offline.';
    }

    return `
        <div class="flex items-center gap-2" title="${title}">
            <div class="w-2.5 h-2.5 rounded-full ${dotClass}"></div>
            <span class="text-xs text-gray-400">${text}</span>
        </div>
    `;
}

function renderAlertUI() {
    const { alert, showAlertInput } = state;
    const bellColor = alert.triggered ? 'text-amber-400 animate-pulse' : (alert.active ? 'text-blue-400' : 'text-gray-400 hover:text-white');

    return `
        <div class="relative flex items-center gap-2">
            <button id="toggle-alert-btn" title="Set Price Alert" class="flex items-center gap-2">
                <svg class="${bellColor} w-6 h-6 transition-colors" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M11.54 2.003a.75.75 0 01.92 0l7.5 6.318a.75.75 0 01-.46 1.342H4.5a.75.75 0 01-.46-1.342l7.5-6.318zM12 8.25a.75.75 0 01.75.75v3.19l4.72-2.106a.75.75 0 01.94.316l1.25 2.5a.75.75 0 01-.44-1.008l-7.5 3.333a.75.75 0 01-.66 0l-7.5-3.333a.75.75 0 01-.44-1.008l1.25-2.5a.75.75 0 01.94-.316l4.72 2.106V9a.75.75 0 01.75.75z" clip-rule="evenodd" /></svg>
                ${alert.active ? `<span class="text-xs text-gray-400 font-mono">Set: $${alert.target.toFixed(2)}</span>` : ''}
            </button>
            ${showAlertInput ? `
                <div class="absolute right-0 top-full mt-2 w-48 bg-gray-900 border border-gray-600 rounded-lg shadow-lg p-3 z-30 fade-in">
                    <label class="text-xs text-gray-400">Alert when price crosses</label>
                    <input id="alert-price-input" type="number" step="0.01" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-amber-500" placeholder="${state.dashboardData?.quote?.price?.toFixed(2) || ''}">
                    <div class="flex gap-2 mt-2">
                        <button id="set-alert-btn" class="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-1 rounded">Set</button>
                        <button id="clear-alert-btn" class="flex-1 bg-gray-600 hover:bg-gray-500 text-white text-xs font-bold py-1 rounded">Clear</button>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

function renderNavigation() {
    const container = document.getElementById('navigation-container');
    const tabs = [
        { key: 'valuation_models', label: 'Valuation Models' },
        { key: 'peer_comparison', label: 'Competitor Benchmarks' },
        { key: 'swot', label: 'Strategic Snapshot' },
        { key: 'memo', label: 'Analyst Memo' }, 
        { key: 'pitch_deck', label: 'Pitch Deck' },
        { key: 'news', label: 'Market Pulse' },
    ];
    container.innerHTML = `
        <div class="flex items-center justify-center gap-2 pb-2 overflow-x-auto">
            ${tabs.map(tab => `
                <button data-tab-key="${tab.key}" class="nav-btn px-4 py-2 text-sm font-semibold rounded-md transition-colors ${state.currentTab === tab.key ? 'bg-amber-600 text-white' : 'bg-gray-700/50 hover:bg-gray-700/80 text-gray-300'}">
                    <span class="whitespace-nowrap">${tab.label}</span>
                </button>
            `).join('')}
        </div>`;
}

function renderContent() {
    const container = document.getElementById('content-container');
    if (state.currentTab === 'valuation_models') {
        renderValuationModelsView(container);
    } else if (state.currentTab === 'peer_comparison') {
        renderPeerComparisonView(container);
    } else if (state.currentTab === 'pitch_deck') {
        renderPitchDeckView(container);
    } else {
        renderIndividualAnalysisView(container, state.currentTab);
    }
}

function renderValuationModelsView(container) {
    const workflow = state.dashboardData?.workflow;
    if (state.loading.data || !workflow) {
        container.innerHTML = `<div class="text-center p-10"><p class="animate-pulse">Loading valuation models...</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="fade-in grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div id="dcf-model-container"></div>
            <div id="lbo-model-container"></div>
        </div>
    `;
    
    renderDcfCard('dcf-model-container');
    renderLboCard('lbo-model-container');
}

function renderDcfCard(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const dcfData = state.dashboardData.workflow.dcfValuation;
    const quote = state.dashboardData.quote;
    const modelType = dcfData.modelType || 'Standard';
    
    const renderSlider = (id, label, min, max, step, value, formatter) => `
        <div class="flex flex-col gap-1">
            <div class="flex justify-between text-sm">
                <label for="${id}" class="font-medium text-gray-300">${label}</label>
                <span id="${id}-value" class="font-mono text-amber-400">${formatter(value)}</span>
            </div>
            <input type="range" id="${id}" data-model="dcf" class="model-slider" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>`;

    let slidersHtml;
    if (modelType === 'Financials') {
        slidersHtml = `
            ${renderSlider('dcf-roe', 'Return on Equity (ROE)', dcfData.inputs.roe.min, dcfData.inputs.roe.max, dcfData.inputs.roe.step, dcfData.inputs.roe.value, formatterService.percent)}
            ${renderSlider('dcf-reinvestmentRate', 'Retention Ratio (1 - Payout)', dcfData.inputs.reinvestmentRate.min, dcfData.inputs.reinvestmentRate.max, dcfData.inputs.reinvestmentRate.step, dcfData.inputs.reinvestmentRate.value, formatterService.percent)}
            ${renderSlider('dcf-costOfEquity', 'Cost of Equity', dcfData.inputs.costOfEquity.min, dcfData.inputs.costOfEquity.max, dcfData.inputs.costOfEquity.step, dcfData.inputs.costOfEquity.value, formatterService.percent)}
            ${renderSlider('dcf-terminalGrowth', 'Terminal Growth', dcfData.inputs.terminalGrowth.min, dcfData.inputs.terminalGrowth.max, dcfData.inputs.terminalGrowth.step, dcfData.inputs.terminalGrowth.value, formatterService.percent)}
        `;
    } else { // Standard Model
        slidersHtml = `
            ${renderSlider('dcf-revenueGrowth', 'Revenue Growth', dcfData.inputs.revenueGrowth.min, dcfData.inputs.revenueGrowth.max, dcfData.inputs.revenueGrowth.step, dcfData.inputs.revenueGrowth.value, formatterService.percent)}
            ${renderSlider('dcf-operatingMargin', 'Operating Margin', dcfData.inputs.operatingMargin.min, dcfData.inputs.operatingMargin.max, dcfData.inputs.operatingMargin.step, dcfData.inputs.operatingMargin.value, formatterService.percent)}
            ${renderSlider('dcf-taxRate', `Tax Rate${quote.taxRateSource || ''}`, dcfData.inputs.taxRate.min, dcfData.inputs.taxRate.max, dcfData.inputs.taxRate.step, dcfData.inputs.taxRate.value, formatterService.percent)}
            ${renderSlider('dcf-reinvestmentRate', 'Reinvestment Rate', dcfData.inputs.reinvestmentRate.min, dcfData.inputs.reinvestmentRate.max, dcfData.inputs.reinvestmentRate.step, dcfData.inputs.reinvestmentRate.value, formatterService.percent)}
            ${renderSlider('dcf-wacc', 'WACC', dcfData.inputs.wacc.min, dcfData.inputs.wacc.max, dcfData.inputs.wacc.step, dcfData.inputs.wacc.value, formatterService.percent)}
            ${renderSlider('dcf-terminalGrowth', 'Terminal Growth', dcfData.inputs.terminalGrowth.min, dcfData.inputs.terminalGrowth.max, dcfData.inputs.terminalGrowth.step, dcfData.inputs.terminalGrowth.value, formatterService.percent)}
        `;
    }
    
    container.innerHTML = `
        <div class="flex flex-col gap-6 h-full">
            <div class="glass-panel rounded-xl p-6">
                <h2 class="text-xl font-semibold mb-4">${dcfData.header.badge}: ${dcfData.header.ticker}</h2>
                <div id="dcf-inputs" class="space-y-4">
                    ${slidersHtml}
                </div>
            </div>
             <div class="glass-panel rounded-xl p-6 flex-grow">
                <h2 class="text-xl font-semibold mb-4">Valuation Summary</h2>
                <div id="dcf-summary-container" class="space-y-3 font-mono text-sm"></div>
            </div>
        </div>`;
    
    renderDcfOutputs();
    document.getElementById('dcf-inputs').addEventListener('input', handleModelInputChange);
}

function renderLboCard(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (state.loading.lbo) {
        container.innerHTML = `<div class="glass-panel rounded-xl p-6 flex items-center justify-center min-h-[400px] h-full"><p class="animate-pulse">Generating AI-powered LBO scenarios...</p></div>`;
        return;
    }

    const allLboScenarios = state.dashboardData.workflow.lboAnalysis.scenarios;
    const lboData = allLboScenarios.find(s => s.header.scenarioId === state.lboScenario);
    
    if (!lboData) {
        container.innerHTML = `<div class="glass-panel rounded-xl p-6"><p class="text-red-500">Could not load LBO scenario: ${state.lboScenario}</p></div>`;
        return;
    }

    const domain = state.dashboardData.quote.domain;
    const scenariosForDomain = DOMAIN_SCENARIOS[domain];

    const isDividendRecap = ['dividendRecap', 'leveragedRecap'].includes(state.lboScenario);
    const isMezzanineLbo = state.lboScenario === 'mezzanineDebt';

    const renderSlider = (id, label, min, max, step, value, formatter) => `
        <div class="flex flex-col gap-1">
            <div class="flex justify-between text-sm">
                <label for="${id}" class="font-medium text-gray-300">${label}</label>
                <span id="${id}-value" class="font-mono text-amber-400">${formatter(value)}</span>
            </div>
            <input type="range" id="${id}" data-model="lbo" class="model-slider" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>`;
    
    container.innerHTML = `
         <div class="flex flex-col gap-6 h-full">
            <div class="glass-panel rounded-xl p-6">
                <h2 class="text-xl font-semibold mb-2">LBO Model: ${lboData.header.ticker}</h2>
                <div class="mb-4">
                  <label for="lbo-scenario-select" class="block text-sm font-medium text-gray-300 mb-1">LBO Scenario</label>
                  <select id="lbo-scenario-select" class="w-full bg-gray-900/50 border border-gray-600 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/50 model-select">
                      ${scenariosForDomain.map(scenario => `
                          <option value="${scenario.id}" ${state.lboScenario === scenario.id ? 'selected' : ''}>${scenario.name}</option>
                      `).join('')}
                  </select>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-mono mb-4">
                    <div class="flex justify-between"><span class="text-gray-400">Purchase Price:</span><span id="lbo-purchase-price-display">${formatterService.largeNumber(lboData.inputs.purchasePrice.value)}</span></div>
                    <div class="flex justify-between"><span class="text-gray-400">Interest Rate:</span><span>${formatterService.percent(lboData.inputs.interestRate.value)}</span></div>
                </div>
                <div id="lbo-inputs" class="space-y-4">
                    ${renderSlider('lbo-debtFinancing', 'Total Debt Financing', lboData.inputs.debtFinancing.min, lboData.inputs.debtFinancing.max, lboData.inputs.debtFinancing.step, lboData.inputs.debtFinancing.value, formatterService.percent)}
                    ${renderSlider('lbo-ebitdaGrowth', 'EBITDA Growth', lboData.inputs.ebitdaGrowth.min, lboData.inputs.ebitdaGrowth.max, lboData.inputs.ebitdaGrowth.step, lboData.inputs.ebitdaGrowth.value, formatterService.percent)}
                    ${renderSlider('lbo-exitMultiple', 'Exit Multiple', lboData.inputs.exitMultiple.min, lboData.inputs.exitMultiple.max, lboData.inputs.exitMultiple.step, lboData.inputs.exitMultiple.value, (v) => formatterService.ratio(v))}
                    ${renderSlider('lbo-holdingPeriod', 'Holding Period (Yrs)', lboData.inputs.holdingPeriod.min, lboData.inputs.holdingPeriod.max, lboData.inputs.holdingPeriod.step, lboData.inputs.holdingPeriod.value, (v) => `${v}`)}
                    <div id="lbo-scenario-inputs" class="space-y-4 pt-2 border-t border-gray-700/50">
                        ${isDividendRecap ? `
                            ${renderSlider('lbo-recapYear', 'Recap Year', lboData.inputs.recapYear.min, lboData.inputs.recapYear.max, lboData.inputs.recapYear.step, lboData.inputs.recapYear.value, (v) => `${v}`)}
                            ${renderSlider('lbo-dividendPayout', 'Dividend Payout %', lboData.inputs.dividendPayout.min, lboData.inputs.dividendPayout.max, lboData.inputs.dividendPayout.step, lboData.inputs.dividendPayout.value, formatterService.percent)}
                        `: ''}
                        ${isMezzanineLbo ? `
                            ${renderSlider('lbo-mezzanineFinancing', 'Mezzanine Financing %', lboData.inputs.mezzanineFinancing.min, lboData.inputs.mezzanineFinancing.max, lboData.inputs.mezzanineFinancing.step, lboData.inputs.mezzanineFinancing.value, formatterService.percent)}
                            ${renderSlider('lbo-mezzanineInterestRate', 'Mezzanine Interest % (PIK)', lboData.inputs.mezzanineInterestRate.min, lboData.inputs.mezzanineInterestRate.max, lboData.inputs.mezzanineInterestRate.step, lboData.inputs.mezzanineInterestRate.value, formatterService.percent)}
                        `: ''}
                    </div>
                </div>
            </div>
            <div class="glass-panel rounded-xl p-6 flex-grow">
                <h2 class="text-xl font-semibold mb-2">LBO Projections & Returns</h2>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left">
                        <thead class="text-xs text-gray-400 uppercase">
                            <tr>
                                <th class="py-2 px-3 text-center">Year</th>
                                <th class="py-2 px-3 text-right">EBITDA</th>
                                <th class="py-2 px-3 text-right">Cash Flow</th>
                                <th class="py-2 px-3 text-right">Ending Debt</th>
                            </tr>
                        </thead>
                        <tbody id="lbo-projections-table" class="font-mono"></tbody>
                    </table>
                </div>
                <div id="lbo-summary-container" class="mt-4"></div>
            </div>
        </div>`;
        
    renderLboOutputs();
    document.getElementById('lbo-inputs').addEventListener('input', handleModelInputChange);
    document.getElementById('lbo-scenario-select').addEventListener('change', handleLboScenarioChange);
}

function renderIndividualAnalysisView(container, type) {
    const analysisData = state.analysisContent[type];
    const content = analysisData ? analysisData.content : null;
    let contentHtml = '';
    
    if (state.loading.analysis) {
        contentHtml = `<div class="text-center p-10"><p class="animate-pulse">Generating ${type.replace(/_/g, ' ')}...</p></div>`;
    } else if (content) {
         contentHtml = `<div class="prose-custom text-gray-300 leading-relaxed">${simpleMarkdownToHtml(content)}</div>`;
    } else {
         contentHtml = `<div class="text-center p-10"><p>No analysis generated yet. Click the navigation tab again to generate.</p></div>`;
    }
    
    container.innerHTML = `
        <div class="glass-panel rounded-xl p-6 fade-in min-h-[50vh]">
            <div class="flex justify-between items-center mb-4">
                <button id="back-btn" class="text-sm font-semibold text-gray-300 hover:text-white">&larr; Back to Valuation Models</button>
                ${content ? `<button id="copy-btn" class="px-3 py-1.5 text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors w-20">Copy</button>` : ''}
            </div>
            ${contentHtml}
        </div>`;
}

function renderPitchDeckView(container) {
    postRenderCallbacks = [];
    const { loading, pitchDeck, ticker, dashboardData } = state;

    if (loading.analysis) {
        container.innerHTML = `<div class="text-center p-10 glass-panel rounded-xl"><p class="animate-pulse">Generating pitch deck slides...</p></div>`;
        return;
    }

    if (!pitchDeck.slides || pitchDeck.slides.length === 0) {
        container.innerHTML = `<div class="text-center p-10 glass-panel rounded-xl"><p>No pitch deck generated yet. Click the navigation tab again to generate.</p></div>`;
        return;
    }

    if (!dashboardData || !dashboardData.quote) {
        container.innerHTML = `<div class="text-center p-10 glass-panel rounded-xl"><p class="text-red-500">Could not render pitch deck: Company data is missing.</p></div>`;
        return;
    }

    const currentSlide = pitchDeck.slides[pitchDeck.currentSlide];
    const contentHtml = simpleMarkdownToHtml(currentSlide.content);

    container.innerHTML = `
        <div class="pitch-deck-container fade-in">
            <header class="pitch-deck-header">
                <div class="company-info">
                    <img src="${dashboardData.quote.logoUrl || apiService.getLogoUrl(ticker)}" alt="${ticker} logo" class="h-8 w-8 object-contain bg-white/90 p-0.5 rounded-full" />
                    <span class="font-semibold text-lg">${dashboardData.quote.companyName}</span>
                </div>
                <div class="flex items-center gap-4">
                    <button id="copy-slide-btn" class="px-3 py-1.5 text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4"><path d="M5.5 2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-5ZM5 2a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 10 .5v1a.5.5 0 0 0 1 0v-1A2.5 2.5 0 0 0 8.5 0h-2A2.5 2.5 0 0 0 4 2.5v1a.5.5 0 0 0 1 0v-1Z" /><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-9ZM3.5 4a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-9Z" /></svg>
                        Copy Slide
                    </button>
                    <div class="slide-counter">
                        <span>${pitchDeck.currentSlide + 1} / ${pitchDeck.slides.length}</span>
                    </div>
                </div>
            </header>
            <div class="pitch-deck-slide">
                <h2 class="slide-title">${currentSlide.title}</h2>
                <div class="slide-body prose-custom text-gray-300 leading-relaxed">
                    ${contentHtml}
                </div>
            </div>
            <footer class="pitch-deck-footer">
                <button id="prev-slide-btn" class="slide-nav-btn" ${pitchDeck.currentSlide === 0 ? 'disabled' : ''}>&larr; Previous</button>
                <span class="confidential-note">Strictly Private and Confidential</span>
                <button id="next-slide-btn" class="slide-nav-btn" ${pitchDeck.currentSlide === pitchDeck.slides.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
            </footer>
        </div>`;

    postRenderCallbacks.forEach(cb => cb());

    document.getElementById('prev-slide-btn')?.addEventListener('click', handlePrevSlide);
    document.getElementById('next-slide-btn')?.addEventListener('click', handleNextSlide);
    document.getElementById('copy-slide-btn')?.addEventListener('click', handleCopySlide);
}


function renderPeerComparisonView(container) {
    const workflow = state.dashboardData?.workflow;
    if (state.loading.data || !workflow) {
        container.innerHTML = `<div class="text-center p-10"><p class="animate-pulse">Loading peer data...</p></div>`;
        return;
    }

    const mainTickerData = state.dashboardData.quote;
    const peersData = state.dashboardData.peers;
    const peerComparisonData = workflow.peerComparison;
    const mainTicker = mainTickerData.ticker;

    const allCompanies = [mainTickerData, ...peersData].map(p => {
        const positionData = peerComparisonData.outputs.positions[p.ticker] || {};
        const evEbitda = (p.ebitda && p.ebitda > 0) ? p.marketCap / p.ebitda : null;
        return {
            companyName: p.companyName,
            ticker: p.ticker,
            marketCap: p.marketCap,
            ebitda: p.ebitda,
            revenueGrowth: p.revenueGrowth,
            peRatio: p.peRatio,
            evEbitda: evEbitda,
            pePosition: positionData['P/E'],
            evEbitdaPosition: positionData['EV/EBITDA'],
        };
    });
    
    const { column, direction } = state.peerSort;
    allCompanies.sort((a, b) => {
        const valA = a[column] || (direction === 'asc' ? Infinity : -Infinity);
        const valB = b[column] || (direction === 'asc' ? Infinity : -Infinity);
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
    
    const maxMarketCap = Math.max(...allCompanies.map(p => p.marketCap || 0));
    const maxEbitda = Math.max(...allCompanies.map(p => p.ebitda || 0));
    const maxRevGrowth = Math.max(...allCompanies.map(p => Math.abs(p.revenueGrowth || 0)));

    const getHeaderClass = (key) => `sortable-header ${state.peerSort.column === key ? state.peerSort.direction : ''}`;
    const getPositionClass = (position) => {
        if (position === 'premium') return 'text-red-400 font-semibold';
        if (position === 'discount') return 'text-green-400 font-semibold';
        return '';
    };
    
    const renderQuartileCard = (title, tickerValue, tickerPosition, quartiles) => {
        const median = quartiles ? quartiles.median : null;
        const q1 = quartiles ? quartiles.q1 : null;
        const q3 = quartiles ? quartiles.q3 : null;

        const rangeText = (q1 !== null && q3 !== null) ? `${formatterService.ratio(q1)} - ${formatterService.ratio(q3)}` : 'N/A';

        return `
        <div class="glass-panel rounded-xl p-4">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-gray-300">${title}</h3>
                <span class="sentiment-tag ${
                    tickerPosition === 'premium' ? 'sentiment-bearish' : 
                    tickerPosition === 'discount' ? 'sentiment-bullish' : 'sentiment-neutral'
                }">${tickerPosition || 'N/A'}</span>
            </div>
            <p class="text-3xl font-bold font-mono mt-2">${formatterService.ratio(tickerValue)}</p>
            <div class="text-xs text-gray-400 space-y-1 mt-3 font-mono">
                <p class="flex justify-between"><span>Peer Median:</span> <span class="font-semibold text-gray-300">${formatterService.ratio(median)}</span></p>
                <p class="flex justify-between"><span>Peer Range (Q1-Q3):</span> <span class="font-semibold text-gray-300">${rangeText}</span></p>
            </div>
        </div>`;
    };
    
    const tickerProcessedData = allCompanies.find(c => c.ticker === mainTicker);
    const { outputs, sentiment, commentary } = peerComparisonData;

    container.innerHTML = `
        <div class="fade-in">
             <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                ${renderQuartileCard(
                    'P/E Ratio (LTM)', 
                    tickerProcessedData.peRatio, 
                    tickerProcessedData.pePosition, 
                    outputs.interquartileRanges['P/E']
                )}
                ${renderQuartileCard(
                    'EV/EBITDA (LTM)', 
                    tickerProcessedData.evEbitda, 
                    tickerProcessedData.evEbitdaPosition, 
                    outputs.interquartileRanges['EV/EBITDA']
                )}
                <div class="glass-panel rounded-xl p-4 md:col-span-2 lg:col-span-2">
                     <h3 class="font-semibold text-gray-300">${sentiment.badge}</h3>
                     <p class="text-sm text-gray-400 mt-2 leading-relaxed">${commentary.text}</p>
                </div>
             </div>

            <div class="glass-panel rounded-xl p-4 sm:p-6">
                <div class="flex flex-wrap justify-between items-center mb-4 gap-3">
                     <h2 class="text-xl font-semibold">👥 Peer Data Table</h2>
                     <button id="export-csv-btn" class="px-3 py-1.5 text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4"><path d="M4 2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Zm0 2a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5Zm0 2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5ZM2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2Zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12Z" /></svg>
                        Export to CSV
                     </button>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left peer-table">
                        <thead class="text-xs text-gray-400 uppercase">
                            <tr>
                                <th scope="col" class="px-6 py-3">Company</th>
                                <th scope="col" class="px-6 py-3 text-right ${getHeaderClass('marketCap')}" data-sort-key="marketCap">Market Cap</th>
                                <th scope="col" class="px-6 py-3 text-right ${getHeaderClass('ebitda')}" data-sort-key="ebitda">EBITDA</th>
                                <th scope="col" class="px-6 py-3 text-right ${getHeaderClass('revenueGrowth')}" data-sort-key="revenueGrowth">Rev. Growth</th>
                                <th scope="col" class="px-6 py-3 text-right ${getHeaderClass('peRatio')}" data-sort-key="peRatio">P/E Ratio</th>
                                <th scope="col" class="px-6 py-3 text-right ${getHeaderClass('evEbitda')}" data-sort-key="evEbitda">EV/EBITDA</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allCompanies.map(peer => `
                                <tr class="${peer.ticker === mainTicker ? 'highlight-row' : ''}">
                                    <th scope="row" class="px-6 py-4 font-medium whitespace-nowrap">
                                        ${peer.companyName} <span class="text-gray-400 font-mono">${peer.ticker}</span>
                                    </th>
                                    <td class="px-6 py-4 text-right">
                                        ${formatterService.largeNumber(peer.marketCap)}
                                        <div class="mini-bar-container"><div class="mini-bar positive" style="width: ${peer.marketCap && maxMarketCap ? (peer.marketCap / maxMarketCap) * 100 : 0}%"></div></div>
                                    </td>
                                    <td class="px-6 py-4 text-right">
                                        ${formatterService.largeNumber(peer.ebitda)}
                                        <div class="mini-bar-container"><div class="mini-bar positive" style="width: ${peer.ebitda && maxEbitda ? (peer.ebitda / maxEbitda) * 100 : 0}%"></div></div>
                                    </td>
                                    <td class="px-6 py-4 text-right ${peer.revenueGrowth < 0 ? 'text-red-400' : 'text-green-400'}">
                                        ${formatterService.percent(peer.revenueGrowth)}
                                        <div class="mini-bar-container"><div class="mini-bar ${peer.revenueGrowth < 0 ? 'negative' : 'positive'}" style="width: ${peer.revenueGrowth && maxRevGrowth ? (Math.abs(peer.revenueGrowth) / maxRevGrowth) * 100 : 0}%"></div></div>
                                    </td>
                                    <td class="px-6 py-4 text-right font-mono ${getPositionClass(peer.pePosition)}">${formatterService.ratio(peer.peRatio)}</td>
                                    <td class="px-6 py-4 text-right font-mono ${getPositionClass(peer.evEbitdaPosition)}">${formatterService.ratio(peer.evEbitda)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                // Fix: Use the consistent formatDateTime helper function.
                <p class="text-xs text-gray-500 mt-4 text-right">Last Updated: ${formatDateTime(new Date())}</p>
            </div>
        </div>`;
    
    document.querySelectorAll('.sortable-header').forEach(header => {
        // Fix: Cast header to HTMLElement to access the dataset property.
        header.addEventListener('click', () => handlePeerSort((header as HTMLElement).dataset.sortKey));
    });
    document.getElementById('export-csv-btn').addEventListener('click', handleExportPeersToCSV);
}

// --- 6. DATA HANDLING & UTILS ---
async function generateLboAssumptionsFromGemini(quote, scenario) {
    if (!ai) return null;

    const scenarioDescription = {
        baseCase: 'standard sponsor-to-sponsor',
        dividendRecap: 'dividend recapitalization',
        mezzanineDebt: 'leveraged buyout with a mezzanine debt tranche',
        ipoExit: 'LBO with a planned IPO exit, potentially justifying a higher exit multiple',
        growthEquity: 'minority growth equity investment in a high-growth tech company to fund expansion, not a traditional buyout. Assume lower leverage (debtFinancing).',
        strategicSale: 'LBO with an exit to a strategic corporate acquirer, which might justify a higher synergy-driven exit multiple.',
        clubDeal: 'large LBO where multiple PE firms pool capital. Assumptions should reflect a larger, more stable target.',
        leveragedRecap: 'leveraged recapitalization for a financial institution, focusing on optimizing the capital structure.',
        sponsorToSponsorExit: 'an exit where one private equity firm sells the company to another, often with a "second bite of the apple" thesis.',
        managementBuyout: 'a transaction where the company\'s existing management team acquires the company, often with financial sponsor backing.',
    }[scenario];

    const scenarioSpecificFields = {
        dividendRecap: 'Also include "recapYear" (as an integer from 2 to 4) and "dividendPayout" (as a number from 0.1 to 0.9).',
        leveragedRecap: 'Also include "recapYear" (as an integer from 2 to 4) and "dividendPayout" (as a number from 0.1 to 0.9).',
        mezzanineDebt: 'Also include "mezzanineFinancing" (as a number from 0.05 to 0.3) and "mezzanineInterestRate" (as a number from 0.1 to 0.2).',
        ipoExit: 'For the "exitMultiple", consider a 10-25% premium over a typical trade sale multiple.',
        strategicSale: 'For the "exitMultiple", consider a 15-30% premium over a typical trade sale multiple due to expected synergies.',
        growthEquity: 'The "debtFinancing" should be lower, between 0.2 and 0.4. "ebitdaGrowth" should be higher.',
    }[scenario] || '';

    const prompt = `
        You are a senior investment banking analyst. For ${quote.companyName} (${quote.ticker}), a ${quote.domain} company with a market cap of ${formatterService.largeNumber(quote.marketCap)} and EBITDA of ${formatterService.largeNumber(quote.ebitda)}, generate a set of reasonable initial assumptions for a ${scenarioDescription} LBO model.

        Return ONLY a single, valid JSON object with the following numeric values:
        - "debtFinancing": Total debt as a percentage of purchase price.
        - "interestRate": Blended interest rate on senior debt.
        - "ebitdaGrowth": Projected annual EBITDA growth rate.
        - "exitMultiple": The LTM EBITDA multiple at exit.
        - "holdingPeriod": The investment hold period in years (integer).
        ${scenarioSpecificFields}

        Base your assumptions on the company's scale and industry-specific private equity deal structures. Ensure the JSON is valid. Example for a base case: {"debtFinancing": 0.6, "interestRate": 0.09, "ebitdaGrowth": 0.08, "exitMultiple": 15, "holdingPeriod": 5}
    `;

    try {
        const response = await ai.models.generateContent({ model, contents: prompt });
        let jsonString = response.text.trim();
        if (jsonString.startsWith("```json")) {
            jsonString = jsonString.substring(7, jsonString.length - 3).trim();
        }
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Failed to generate or parse LBO assumptions from Gemini:", e);
        return null;
    }
}

async function generateValuationWorkflow(quote, peers) {
    const meta = {
        selectedTicker: quote.ticker,
        title: "Pitchly Valuation Workflow"
    };
    const dcfValuation = generateDcfModelData(quote);
    const lboAnalysis = await generateLboModelData(quote);
    const peerComparison = generatePeerComparisonModelData(quote, peers);

    return { meta, dcfValuation, lboAnalysis, peerComparison };
}

function generateDcfModelData(quote) {
    if (quote.domain === 'Financials') {
        const initialAssumptions = {
            roe: quote.roe || 0.12,
            reinvestmentRate: 0.60, // This is the Retention Ratio for banks
            costOfEquity: 0.10,
            terminalGrowth: 0.02,
        };
        const outputs = calculateDcfOutputs(quote, initialAssumptions);
        return {
            header: { ticker: quote.ticker, badge: "DDM/ROE Model" },
            modelType: 'Financials',
            inputs: {
                roe: { label: 'Return on Equity (ROE)', value: initialAssumptions.roe, min: 0.05, max: 0.25, step: 0.005 },
                reinvestmentRate: { label: 'Retention Ratio (1 - Payout)', value: initialAssumptions.reinvestmentRate, min: 0.2, max: 0.8, step: 0.01 },
                costOfEquity: { label: 'Cost of Equity', value: initialAssumptions.costOfEquity, min: 0.07, max: 0.15, step: 0.001 },
                terminalGrowth: { label: 'Terminal Growth', value: initialAssumptions.terminalGrowth, min: 0.01, max: 0.04, step: 0.001 },
            },
            ...getDcfSentimentAndCommentary(outputs, quote),
            outputs: outputs,
        };
    }

    // Standard model for non-financials
    const initialAssumptions = {
        revenueGrowth: 0.15,
        operatingMargin: 0.18,
        taxRate: quote.taxRate || 0.21,
        reinvestmentRate: 0.30,
        wacc: 0.095,
        terminalGrowth: 0.025,
    };
    const outputs = calculateDcfOutputs(quote, initialAssumptions);
    return {
        header: { ticker: quote.ticker, badge: "DCF Model" },
        modelType: 'Standard',
        inputs: {
            revenueGrowth: { label: 'Revenue Growth', value: initialAssumptions.revenueGrowth, min: 0, max: 0.5, step: 0.005 },
            operatingMargin: { label: 'Operating Margin', value: initialAssumptions.operatingMargin, min: 0, max: 0.4, step: 0.005 },
            taxRate: { label: `Tax Rate${quote.taxRateSource || ''}`, value: initialAssumptions.taxRate, min: 0.1, max: 0.4, step: 0.005 },
            reinvestmentRate: { label: 'Reinvestment Rate', value: initialAssumptions.reinvestmentRate, min: 0, max: 1, step: 0.01 },
            wacc: { label: 'WACC', value: initialAssumptions.wacc, min: 0.05, max: 0.15, step: 0.001 },
            terminalGrowth: { label: 'Terminal Growth', value: initialAssumptions.terminalGrowth, min: 0.01, max: 0.05, step: 0.001 },
        },
        ...getDcfSentimentAndCommentary(outputs, quote),
        outputs: outputs,
    };
}

async function generateLboModelData(quote) {
    const scenarios = [];
    const domain = quote.domain;
    const scenariosForDomain = DOMAIN_SCENARIOS[domain];

    for (const scenario of scenariosForDomain) {
        const geminiAssumptions = await generateLboAssumptionsFromGemini(quote, scenario.id);

        const baseAssumptions = {
            purchasePrice: quote.marketCap,
            debtFinancing: geminiAssumptions?.debtFinancing ?? 0.60,
            interestRate: geminiAssumptions?.interestRate ?? quote.interestRate ?? 0.085,
            ebitdaGrowth: geminiAssumptions?.ebitdaGrowth ?? 0.08,
            exitMultiple: geminiAssumptions?.exitMultiple ?? (quote.peRatio ? Math.min(25, Math.max(8, quote.peRatio * 0.8)) : 15),
            holdingPeriod: geminiAssumptions?.holdingPeriod ?? 5,
        };

        const inputs: { [key: string]: any } = {
            purchasePrice: { label: 'Purchase Price', value: baseAssumptions.purchasePrice },
            interestRate: { label: 'Interest Rate', value: baseAssumptions.interestRate, min: 0.05, max: 0.15, step: 0.005 },
            debtFinancing: { label: 'Total Debt Financing', value: baseAssumptions.debtFinancing, min: 0.2, max: 0.8, step: 0.01 },
            ebitdaGrowth: { label: 'EBITDA Growth', value: baseAssumptions.ebitdaGrowth, min: 0, max: 0.3, step: 0.005 },
            exitMultiple: { label: 'Exit Multiple', value: baseAssumptions.exitMultiple, min: 5, max: 40, step: 0.5 },
            holdingPeriod: { label: 'Holding Period', value: baseAssumptions.holdingPeriod, min: 3, max: 7, step: 1 },
        };
        
        const scenarioAssumptions: { [key: string]: any } = {};
        if (['dividendRecap', 'leveragedRecap'].includes(scenario.id)) {
            scenarioAssumptions.recapYear = geminiAssumptions?.recapYear ?? 3;
            scenarioAssumptions.dividendPayout = geminiAssumptions?.dividendPayout ?? 0.5;
            inputs.recapYear = { label: 'Recap Year', value: scenarioAssumptions.recapYear, min: 2, max: baseAssumptions.holdingPeriod - 1, step: 1 };
            inputs.dividendPayout = { label: 'Dividend Payout %', value: scenarioAssumptions.dividendPayout, min: 0.1, max: 0.9, step: 0.05 };
        } else if (scenario.id === 'mezzanineDebt') {
            scenarioAssumptions.mezzanineFinancing = geminiAssumptions?.mezzanineFinancing ?? 0.15;
            scenarioAssumptions.mezzanineInterestRate = geminiAssumptions?.mezzanineInterestRate ?? 0.14;
            inputs.mezzanineFinancing = { label: 'Mezzanine Financing %', value: scenarioAssumptions.mezzanineFinancing, min: 0.05, max: 0.30, step: 0.01 };
            inputs.mezzanineInterestRate = { label: 'Mezzanine Interest % (PIK)', value: scenarioAssumptions.mezzanineInterestRate, min: 0.10, max: 0.20, step: 0.005 };
        }
        
        const allAssumptions = { ...baseAssumptions, ...scenarioAssumptions };
        const calculatedOutputs = calculateLboOutputs(quote, allAssumptions, scenario.id);
        const { sentiment, commentary } = getLboSentimentAndCommentary(calculatedOutputs.irr, calculatedOutputs.moic, scenario.id);
        
        const scenarioData = {
            header: {
                ticker: quote.ticker,
                scenarioId: scenario.id,
                scenarioName: scenario.name,
                badge: sentiment.badge,
            },
            inputs: inputs,
            outputs: {
                ebitda: calculatedOutputs.projections.map(p => p.ebitda),
                cashFlow: calculatedOutputs.projections.map(p => p.cashFlow),
                debtBalance: calculatedOutputs.projections.map(p => p.debtBalance),
                sponsorEquity: calculatedOutputs.initialEquity,
                seniorDebt: calculatedOutputs.initialSeniorDebt,
                mezzanineDebt: calculatedOutputs.initialMezzanineDebt,
                exitEquityValue: calculatedOutputs.exitEquityValue,
                irr: calculatedOutputs.irr,
                moic: calculatedOutputs.moic,
                dividendPaid: calculatedOutputs.dividendPaid,
            },
            sentiment: sentiment.badge,
            commentary: commentary.text,
        };
        scenarios.push(scenarioData);
    }
    return { scenarios };
}


function generatePeerComparisonModelData(quote, peers) {
     if (!peers || peers.length === 0) {
        return {
            header: { baseTicker: quote.ticker },
            inputs: { multiples: ['P/E', 'EV/EBITDA', 'P/S'] },
            outputs: { peers: [], interquartileRanges: {}, positions: {} },
            sentiment: { badge: 'Limited Data' },
            commentary: { text: `Peer data could not be automatically resolved for ${quote.ticker}. Comparison is unavailable.` }
        };
    }

    const allCompaniesData = [quote, ...peers];
    const processedCompanies = allCompaniesData.map(c => ({
        ...c,
        evEbitda: (c.ebitda && c.ebitda > 0 && c.marketCap) ? c.marketCap / c.ebitda : null,
        psRatio: (c.revenue && c.revenue > 0 && c.marketCap) ? c.marketCap / c.revenue : null,
    }));

    const calculateQuartiles = (arr) => {
        const sorted = arr.filter(v => v !== null && isFinite(v) && v > 0).sort((a, b) => a - b);
        if (sorted.length < 4) return { q1: null, median: null, q3: null };
        const q1Index = Math.floor(sorted.length * 0.25);
        const medianIndex = Math.floor(sorted.length * 0.5);
        const q3Index = Math.floor(sorted.length * 0.75);
        return { q1: sorted[q1Index], median: sorted[medianIndex], q3: sorted[q3Index] };
    };

    const iqr = {
        'P/E': calculateQuartiles(processedCompanies.map(c => c.peRatio)),
        'EV/EBITDA': calculateQuartiles(processedCompanies.map(c => c.evEbitda)),
        'P/S': calculateQuartiles(processedCompanies.map(c => c.psRatio)),
    };

    const getPosition = (value, quartiles) => {
        if (value === null || quartiles.q1 === null || quartiles.q3 === null) return 'in-line'; // Default for N/A
        if (value > quartiles.q3 * 1.1) return 'premium';
        if (value < quartiles.q1 * 0.9) return 'discount';
        return 'in-line';
    };

    const positions = {};
    processedCompanies.forEach(c => {
        positions[c.ticker] = {
            'P/E': getPosition(c.peRatio, iqr['P/E']),
            'EV/EBITDA': getPosition(c.evEbitda, iqr['EV/EBITDA']),
            'P/S': getPosition(c.psRatio, iqr['P/S']),
        };
    });

    const premiumCount = Object.values(positions[quote.ticker]).filter(p => p === 'premium').length;
    const discountCount = Object.values(positions[quote.ticker]).filter(p => p === 'discount').length;
    
    let sentimentBadge, commentary;
    if(premiumCount > discountCount) {
        sentimentBadge = 'Premium-heavy';
        commentary = `${quote.ticker} trades at a significant premium across key multiples, reflecting strong market sentiment and growth expectations relative to peers.`;
    } else if (discountCount > premiumCount) {
        sentimentBadge = 'Discount-heavy';
        commentary = `${quote.ticker} appears to trade at a discount to its peer group, suggesting potential undervaluation or perceived higher risk.`;
    } else {
        sentimentBadge = 'Mixed';
        commentary = `Valuation for ${quote.ticker} is mixed compared to peers, trading at a premium on some multiples and a discount on others.`;
    }

    return {
        header: { baseTicker: quote.ticker },
        inputs: { multiples: ['P/E', 'EV/EBITDA', 'P/S'] },
        outputs: { peers: peers.map(p => p.ticker), interquartileRanges: iqr, positions: positions },
        sentiment: { badge: sentimentBadge },
        commentary: { text: commentary }
    };
}

function calculateDcfOutputs(baseData, assumptions) {
    const { domain, marketCap, pbRatio, shares, price, ebitda, psRatio } = baseData;
    let { revenue, netDebt } = baseData;

    // Financials use a Dividend Discount Model (DDM) based on ROE
    if (domain === 'Financials') {
        const { roe, reinvestmentRate, costOfEquity, terminalGrowth } = assumptions;
        
        if (!marketCap || !pbRatio || pbRatio <= 0) {
            return { revenue: "N/A", fcff: [], pvContributions: { fcff: 0, terminal: 0 }, enterpriseValue: 0, equityValue: 0, perShareValue: "N/A", potentialUpside: "N/A", error: 'Missing Market Cap or P/B Ratio. Cannot perform DDM valuation.' };
        }
        const bookValue = marketCap / pbRatio;
        if (bookValue <= 0) {
            return { revenue: "N/A", fcff: [], pvContributions: { fcff: 0, terminal: 0 }, enterpriseValue: 0, equityValue: 0, perShareValue: "N/A", potentialUpside: "N/A", error: 'Invalid Book Value derived. Cannot perform DDM valuation.' };
        }

        const projections = [];
        let currentBookValue = bookValue;
        for (let i = 1; i <= 10; i++) {
            const netIncome = currentBookValue * roe;
            const reinvestment = netIncome * reinvestmentRate;
            const fcfe = netIncome - reinvestment;
            currentBookValue += reinvestment;
            projections.push({ year: i, fcfe });
        }

        const sumPvFcfe = projections.reduce((sum, p, i) => sum + p.fcfe / Math.pow(1 + costOfEquity, i + 1), 0);
        const lastFcfe = projections[projections.length - 1].fcfe;
        const terminalValue = (lastFcfe * (1 + terminalGrowth)) / (costOfEquity - terminalGrowth);
        const pvTerminalValue = terminalValue / Math.pow(1 + costOfEquity, 10);
        
        const equityValue = sumPvFcfe + pvTerminalValue;
        const perShareValue = (shares && shares > 0) ? equityValue / shares : null;
        const potentialUpside = (perShareValue !== null && price) ? (perShareValue - price) / price : null;

        return {
            revenue: "N/A (DDM Model)",
            fcff: projections.map(p => p.fcfe), // Re-using fcff field for FCFE
            pvContributions: { fcff: sumPvFcfe, terminal: pvTerminalValue },
            enterpriseValue: equityValue, // For banks, EV is not a standard concept, we directly value equity
            equityValue,
            perShareValue: perShareValue ?? "N/A",
            potentialUpside: potentialUpside ?? "N/A",
            derivedRevenueSource: `Valuation based on a Dividend Discount Model using Book Value, ROE, and Cost of Equity.`,
            error: perShareValue === null ? 'Missing or invalid Shares Outstanding data.' : null
        };
    }

    // Standard FCFF model for non-financials
    const { revenueGrowth, operatingMargin, taxRate, reinvestmentRate, wacc, terminalGrowth } = assumptions;
    let derivedRevenueSource = null;
    if (revenue == null || revenue <= 0) {
        if (ebitda && ebitda > 0 && operatingMargin > 0) {
            revenue = ebitda / operatingMargin;
            derivedRevenueSource = 'Revenue was derived from EBITDA and Operating Margin.';
        } else if (marketCap && psRatio && psRatio > 0) {
            revenue = marketCap / psRatio;
            derivedRevenueSource = 'Revenue was derived from Market Cap and P/S Ratio.';
        }
    }

    if (revenue === null || revenue <= 0 || typeof revenue === 'string') {
        return { revenue: "N/A", fcff: [], pvContributions: { fcff: 0, terminal: 0 }, enterpriseValue: 0, equityValue: 0, perShareValue: "N/A", potentialUpside: "N/A", derivedRevenueSource, error: 'Revenue could not be derived. Cannot perform DCF.' };
    }

    const projections = [];
    let currentRevenue = revenue;
    for (let i = 1; i <= 10; i++) {
        currentRevenue *= (1 + revenueGrowth);
        const ebit = currentRevenue * operatingMargin;
        const nopat = ebit * (1 - taxRate);
        const reinvestment = nopat * reinvestmentRate;
        const fcff = nopat - reinvestment;
        projections.push({ year: i, revenue: currentRevenue, fcff });
    }

    const sumPvFcff = projections.reduce((sum, p, i) => sum + p.fcff / Math.pow(1 + wacc, i + 1), 0);
    const lastFcff = projections[projections.length - 1].fcff;
    const terminalValue = (lastFcff * (1 + terminalGrowth)) / (wacc - terminalGrowth);
    const pvTerminalValue = terminalValue / Math.pow(1 + wacc, 10);
    
    const enterpriseValue = sumPvFcff + pvTerminalValue;
    const equityValue = enterpriseValue - (netDebt || 0); 
    const perShareValue = (shares && shares > 0) ? equityValue / shares : null;
    const potentialUpside = (perShareValue !== null && price) ? (perShareValue - price) / price : null;

    return {
        revenue,
        fcff: projections.map(p => p.fcff),
        pvContributions: { fcff: sumPvFcff, terminal: pvTerminalValue },
        enterpriseValue,
        equityValue,
        perShareValue: perShareValue ?? "N/A",
        potentialUpside: potentialUpside ?? "N/A",
        derivedRevenueSource,
        error: perShareValue === null ? 'Missing or invalid Shares Outstanding data. Cannot calculate per-share value.' : null
    };
}

function calculateLboOutputs(baseData, assumptions, scenario = 'baseCase') {
    let { ebitda, marketCap, evEbitda, taxRate } = baseData;
    const { purchasePrice, debtFinancing, interestRate, ebitdaGrowth, exitMultiple, holdingPeriod } = assumptions;

    if (!purchasePrice) {
        return { projections: [], exitEquityValue: 0, irr: 0, moic: 0, dividendPaid: 0, initialSeniorDebt: 0, initialMezzanineDebt: 0, initialEquity: 0 };
    }
    
    if (!ebitda || ebitda <= 0) {
        if (marketCap && evEbitda && evEbitda > 0) {
            ebitda = marketCap / evEbitda;
        } else if (exitMultiple > 0) {
            ebitda = (purchasePrice / exitMultiple) / Math.pow(1 + ebitdaGrowth, holdingPeriod);
        }
    }

    if (!ebitda || ebitda <= 0) {
         return { projections: [], exitEquityValue: 0, irr: 0, moic: 0, dividendPaid: 0, initialSeniorDebt: 0, initialMezzanineDebt: 0, initialEquity: 0 };
    }
    
    let initialSeniorDebt = 0;
    let initialMezzanineDebt = 0;
    
    if (scenario === 'mezzanineDebt') {
        const mezzanineFinancing = Math.min(debtFinancing, assumptions.mezzanineFinancing);
        const seniorFinancing = debtFinancing - mezzanineFinancing;
        initialSeniorDebt = purchasePrice * seniorFinancing;
        initialMezzanineDebt = purchasePrice * mezzanineFinancing;
    } else {
        initialSeniorDebt = purchasePrice * debtFinancing;
    }

    const totalInitialDebt = initialSeniorDebt + initialMezzanineDebt;
    const initialEquity = purchasePrice - totalInitialDebt;

    const projections = [];
    let currentEbitda = ebitda;
    let currentSeniorDebt = initialSeniorDebt;
    let currentMezzanineDebt = initialMezzanineDebt;
    let dividendPaidTotal = 0;

    for (let i = 1; i <= holdingPeriod; i++) {
        currentEbitda *= (1 + ebitdaGrowth);
        
        if (['dividendRecap', 'leveragedRecap'].includes(scenario) && i === assumptions.recapYear) {
            const currentTotalDebt = currentSeniorDebt + currentMezzanineDebt;
            const equityValuePreRecap = (currentEbitda * exitMultiple) - currentTotalDebt;
            const dividendAmount = equityValuePreRecap * assumptions.dividendPayout;
            dividendPaidTotal += dividendAmount;
            currentSeniorDebt += dividendAmount;
        }

        const seniorInterest = currentSeniorDebt * interestRate;
        let cashInterest = seniorInterest;
        let pikInterest = 0;

        if (scenario === 'mezzanineDebt') {
            pikInterest = currentMezzanineDebt * assumptions.mezzanineInterestRate;
        }
        
        const cashFlow = (currentEbitda - cashInterest) * (1 - taxRate);
        const debtPaid = Math.min(currentSeniorDebt, cashFlow > 0 ? cashFlow : 0);
        
        currentSeniorDebt -= debtPaid;
        if (scenario === 'mezzanineDebt') {
             currentMezzanineDebt += pikInterest; // PIK interest accrues
        }
        
        const totalDebtBalance = currentSeniorDebt + currentMezzanineDebt;
        projections.push({ year: i, ebitda: currentEbitda, debtBalance: totalDebtBalance, cashFlow });
    }

    const finalTotalDebt = projections[projections.length - 1].debtBalance;
    const exitEv = projections[projections.length - 1].ebitda * exitMultiple;
    const exitEquityValue = exitEv - finalTotalDebt;
    const totalCashToSponsor = exitEquityValue + dividendPaidTotal;

    let moic = 0, irr = 0;
    if (initialEquity > 0 && totalCashToSponsor >= 0) {
        moic = totalCashToSponsor / initialEquity;
        irr = moic > 0 ? Math.pow(moic, 1 / holdingPeriod) - 1 : -1.0;
    } else if (initialEquity <= 0) {
        moic = 0;
        irr = 0;
    }

    return {
        projections,
        exitEquityValue: exitEquityValue,
        irr,
        moic,
        dividendPaid: dividendPaidTotal,
        initialSeniorDebt,
        initialMezzanineDebt,
        initialEquity
    };
}


function getDcfSentimentAndCommentary(outputs, quote) {
    const { potentialUpside, derivedRevenueSource } = outputs;
    const { taxRate, taxRateIsAssumed, domain } = quote;
    
    if (potentialUpside === "N/A" || typeof potentialUpside !== 'number') {
        return { sentiment: { badge: 'Incomplete' }, commentary: { text: outputs.error || 'Per-share value cannot be determined.' } };
    }

    let badge, baseText;
    if (potentialUpside > 0.15) {
        badge = 'Undervalued';
        baseText = `The model indicates the stock is undervalued, driven by strong growth and margin assumptions.`;
    } else if (potentialUpside < -0.15) {
        badge = 'Overvalued';
        baseText = `High valuation multiples are not supported by fundamentals, suggesting the stock is overvalued.`;
    } else {
        badge = 'Fair Value';
        baseText = `The stock appears to be fairly valued, with market price aligning closely with intrinsic value estimates.`;
    }

    let commentaryText = baseText;
    if (derivedRevenueSource) {
        commentaryText = domain === 'Financials'
            ? `${derivedRevenueSource} ${baseText}`
            : `${baseText} ${derivedRevenueSource}`;
    }
    if (taxRateIsAssumed) {
        commentaryText += ` A statutory tax rate of ${formatterService.percent(taxRate)} was assumed.`;
    }
    
    return { sentiment: { badge }, commentary: { text: commentaryText } };
}

function getLboSentimentAndCommentary(irr, moic, scenario) {
     let badge, text;
    if (irr > 0.20) {
        badge = 'Attractive IRR';
        if (['dividendRecap', 'leveragedRecap'].includes(scenario)) {
            text = `The recapitalization strategy boosts IRR to ${formatterService.percent(irr)}, accelerating returns to the sponsor.`;
        } else if (scenario === 'mezzanineDebt') {
            text = `The use of mezzanine financing increases leverage, boosting the IRR to ${formatterService.percent(irr)} but elevating the risk profile.`;
        } else if (scenario === 'ipoExit') {
            text = `A successful IPO exit at a premium multiple could yield an attractive IRR of ${formatterService.percent(irr)}.`;
        } else if (scenario === 'growthEquity') {
            text = `High growth assumptions lead to a strong ${formatterService.percent(irr)} IRR, typical of successful growth equity deals.`;
        } else if (scenario === 'strategicSale') {
            text = `An exit to a strategic buyer with synergies unlocks a ${formatterService.percent(irr)} IRR.`;
        } else if (scenario === 'clubDeal') {
            text = `The scale of this club deal allows for stable cash flows, supporting a solid ${formatterService.percent(irr)} IRR.`;
        } else if (scenario === 'sponsorToSponsorExit') {
            text = `A secondary buyout thesis is supported by a compelling ${formatterService.percent(irr)} IRR, indicating further value creation potential.`;
        } else if (scenario === 'managementBuyout') {
            text = `Aligning with management in an MBO proves fruitful, delivering a ${formatterService.percent(irr)} IRR.`;
        }
         else {
            text = `This LBO delivers a ${formatterService.percent(irr)} IRR, driven by strong EBITDA growth and deleveraging.`;
        }
    } else {
        badge = 'Weak IRR';
        if (scenario === 'mezzanineDebt') {
             text = `Even with additional leverage from mezzanine debt, the IRR of ${formatterService.percent(irr)} is weak.`;
        } else if (scenario === 'ipoExit') {
            text = `The projected IRR of ${formatterService.percent(irr)} is weak, suggesting the IPO premium may not justify the risk.`;
        } else if (scenario === 'growthEquity') {
            text = `The projected ${formatterService.percent(irr)} IRR is low for a growth equity case, questioning the growth story.`;
        } else {
            text = `The projected IRR of ${formatterService.percent(irr)} may not meet typical private equity return hurdles.`;
        }
    }
    return { sentiment: { badge }, commentary: { text } };
}

function renderDcfOutputs() {
    const workflow = state.dashboardData.workflow;
    const { dcfValuation } = workflow;
    const currentPrice = state.dashboardData.quote.price;
    const { outputs, sentiment, commentary } = dcfValuation;
    const { perShareValue, potentialUpside, error } = outputs;

    let perShareHtml, upsideHtml, sentimentHtml;

    if (error || perShareValue === "N/A") {
        perShareHtml = `<span class="text-gray-500 font-bold">N/A</span>`;
        upsideHtml = `<span class="text-gray-500">N/A</span>`;
        sentimentHtml = `
            <div class="mt-4">
                <span class="sentiment-tag sentiment-neutral">Incomplete Data</span>
                <p class="text-xs text-yellow-400 mt-2 italic">${commentary.text}</p>
            </div>
        `;
    } else {
        const sentimentClass = sentiment.badge === 'Undervalued' ? 'sentiment-bullish' : sentiment.badge === 'Overvalued' ? 'sentiment-bearish' : 'sentiment-neutral';
        perShareHtml = `<span class="text-amber-400 font-bold">${formatterService.currency(perShareValue)}</span>`;
        upsideHtml = `<span class="${potentialUpside >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">${formatterService.percent(potentialUpside)}</span>`;
        sentimentHtml = `
            <div class="mt-4">
                <span class="sentiment-tag ${sentimentClass}">${sentiment.badge}</span>
                <p class="text-xs text-gray-400 mt-2 italic">${commentary.text}</p>
            </div>
        `;
    }
    
    const summaryContainer = document.getElementById('dcf-summary-container');
    summaryContainer.innerHTML = `
        <div class="flex justify-between items-baseline"><span class="text-gray-400">Enterprise Value:</span><span class="font-semibold">${formatterService.largeNumber(outputs.enterpriseValue)}</span></div>
        <div class="flex justify-between items-baseline"><span class="text-gray-400">Equity Value:</span><span class="font-semibold">${formatterService.largeNumber(outputs.equityValue)}</span></div>
        <hr class="border-gray-600 my-2">
        <div class="flex justify-between items-center text-lg mt-2">
            <span class="text-amber-400 font-semibold">Intrinsic Value / Share:</span>
            ${perShareHtml}
        </div>
        <div class="flex justify-between items-center text-sm mt-1">
            <span class="text-gray-400">Current Price:</span>
            <span>${formatterService.currency(currentPrice)}</span>
        </div>
         <div class="flex justify-between items-center text-sm mt-1">
            <span class="text-gray-400">Potential Upside:</span>
            ${upsideHtml}
        </div>
        ${sentimentHtml}`;
}

function renderLboOutputs() {
    const allLboScenarios = state.dashboardData.workflow.lboAnalysis.scenarios;
    const lboData = allLboScenarios.find(s => s.header.scenarioId === state.lboScenario);
    
    if (!lboData) {
        console.error("Could not find LBO data for scenario:", state.lboScenario);
        return;
    }
    
    const { outputs, sentiment, commentary } = lboData;

    const tableBody = document.getElementById('lbo-projections-table');
    tableBody.innerHTML = outputs.ebitda.map((ebitdaVal, i) => `
        <tr class="border-b border-gray-700/50">
            <td class="py-2 px-3 text-center text-gray-400">${i + 1}</td>
            <td class="py-2 px-3 text-right">${formatterService.largeNumber(ebitdaVal)}</td>
            <td class="py-2 px-3 text-right">${formatterService.largeNumber(outputs.cashFlow[i])}</td>
            <td class="py-2 px-3 text-right">${formatterService.largeNumber(outputs.debtBalance[i])}</td>
        </tr>`).join('');
    
    const summaryContainer = document.getElementById('lbo-summary-container');
    const sentimentClass = sentiment === 'Attractive IRR' ? 'sentiment-bullish' : 'sentiment-bearish';
    
    let summaryContent;
    if (state.lboScenario === 'mezzanineDebt') {
        summaryContent = `
            <div class="mb-3">
                <p class="text-gray-400 text-sm text-center font-semibold mb-1">Initial Capitalization</p>
                <div class="text-xs font-mono space-y-1">
                    <div class="flex justify-between"><span class="text-gray-400">Sponsor Equity:</span><span class="font-semibold">${formatterService.largeNumber(outputs.sponsorEquity)}</span></div>
                    <div class="flex justify-between"><span class="text-gray-400">Senior Debt:</span><span class="font-semibold">${formatterService.largeNumber(outputs.seniorDebt)}</span></div>
                    <div class="flex justify-between"><span class="text-gray-400">Mezzanine Debt:</span><span class="font-semibold">${formatterService.largeNumber(outputs.mezzanineDebt)}</span></div>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-x-2 gap-y-2 font-mono text-center pt-2 border-t border-gray-700/50">
                <div><p class="text-gray-400 text-xs">Exit Equity</p><p class="text-lg font-bold">${formatterService.largeNumber(outputs.exitEquityValue)}</p></div>
                <div><p class="text-gray-400 text-xs">MOIC</p><p class="text-xl font-bold text-amber-400">${formatterService.ratio(outputs.moic)}</p></div>
                <div><p class="text-gray-400 text-xs">IRR</p><p class="text-xl font-bold text-amber-400">${formatterService.percent(outputs.irr)}</p></div>
            </div>
        `;
    } else {
        const dividendPaid = outputs.dividendPaid || 0;

        summaryContent = `
            <div class="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-center">
                <div>
                    <p class="text-gray-400 text-sm">Sponsor's Exit Equity</p>
                    <p class="text-xl font-bold">${formatterService.largeNumber(outputs.exitEquityValue)}</p>
                </div>
                ${(['dividendRecap', 'leveragedRecap'].includes(state.lboScenario)) && dividendPaid > 0 ? `
                    <div>
                        <p class="text-gray-400 text-sm">Sponsor's Dividends</p>
                        <p class="text-xl font-bold text-cyan-400">${formatterService.largeNumber(dividendPaid)}</p>
                    </div>
                ` : `
                    <div>
                        <p class="text-gray-400 text-sm">Sentiment</p>
                        <span class="mt-1 sentiment-tag ${sentimentClass}">${sentiment}</span>
                    </div>
                `}
                <div>
                    <p class="text-gray-400 text-sm">Implied MOIC</p>
                    <p class="text-2xl font-bold text-amber-400">${formatterService.ratio(outputs.moic)}</p>
                </div>
                <div>
                    <p class="text-gray-400 text-sm">Implied IRR</p>
                    <p class="text-2xl font-bold text-amber-400">${formatterService.percent(outputs.irr)}</p>
                </div>
            </div>
        `;
    }

    summaryContainer.innerHTML = summaryContent + `<p class="text-xs text-gray-400 mt-3 italic text-center">${commentary}</p>`;
}


async function fetchData(ticker) {
    state.loading.data = true;
    state.error = null;
    state.realtimeStatus = 'connecting';
    renderApp();
    try {
        const quote = await apiService.getTickerSummary(ticker);
        const peerTickers = peerMap[ticker.toUpperCase()] || [];

        // Fetch peers sequentially with a delay to avoid rate-limiting
        const peers = [];
        for (const t of peerTickers) {
            try {
                const peerData = await apiService.getTickerSummary(t);
                peers.push(peerData);
            } catch (e) {
                console.warn(`Could not fetch data for peer ${t}:`, e.message);
                peers.push(null);
            }
            await new Promise(res => setTimeout(res, 250)); // 250ms delay between requests
        }
        
        const validPeers = peers.filter(p => p !== null);
        
        state.loading.lbo = true;
        renderApp();
        
        const workflowData = await generateValuationWorkflow(quote, validPeers);
        state.dashboardData = { quote, peers: validPeers, workflow: workflowData };
        state.realtimeStatus = 'connected';
        state.loading.lbo = false;

    } catch (err) {
        console.error(`Failed to load dashboard data:`, err);
        state.error = err.message;
        state.dashboardData = null;
        state.realtimeStatus = 'error';
    } finally {
        state.loading.data = false;
        state.loading.lbo = false;
        renderApp();
    }
}
function simpleMarkdownToHtml(text) {
    if (!text) return '';

    let processedText = text;

    // Remove old visual placeholders first
    processedText = processedText.replace(/\[Visual: (.*?)\]/g, '');

    // 1. Charts
    processedText = processedText.replace(/\[CHART type="([^"]+)" title="([^"]+)"\]\n?([\s\S]*?)\n?\[\/CHART\]/g, (match, type, title, data) => {
        const elementId = `chart-${Math.random().toString(36).substr(2, 9)}`;
        postRenderCallbacks.push(() => renderChart(elementId, type, title, data));
        return `<div id="${elementId}" class="chart-container"></div>`;
    });

    // 2. Diagrams
    processedText = processedText.replace(/\[DIAGRAM type="([^"]+)"\]\n?([\s\S]*?)\n?\[\/DIAGRAM\]/g, (match, type, data) => {
        return renderDiagram(type, data);
    });

    // 3. Tables (must run before paragraphs and line breaks)
    const tableRegex = /^\|(.+)\|\r?\n\|( *:?-+:? *\|)+([\s\S]*?)(?=\n\n|\n###|\n##|\n#|\Z)/gm;
    processedText = processedText.replace(tableRegex, (tableMatch) => {
        const lines = tableMatch.trim().split('\n');
        const headerCells = lines[0].trim().slice(1, -1).split('|').map(h => `<th>${h.trim()}</th>`).join('');
        const bodyRows = lines.slice(2).map(row => {
            const cells = row.trim().slice(1, -1).split('|').map(c => `<td>${c.trim()}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    });
    
    // 4. Headings
    processedText = processedText.replace(/^\s*### (.*$)/gim, '<h3>$1</h3>');
    processedText = processedText.replace(/^\s*## (.*$)/gim, '<h2>$1</h2>');
    processedText = processedText.replace(/^\s*# (.*$)/gim, '<h1>$1</h1>');

    // 5. Lists (handle consecutive items)
    processedText = processedText.replace(/^\s*[-*] (.*$)/gim, '<li>$1</li>');
    processedText = processedText.replace(/(<\/li>\s*<li>)/g, '</li><li>');
    processedText = processedText.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');

    // 6. Inline elements
    processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 7. Paragraphs and line breaks
    const blocks = processedText.split(/(<(?:table|ul|h[1-3]|div)[\s\S]*?<\/(?:table|ul|h[1-3]|div)>)/g);
    const html = blocks.map(block => {
        if (block.startsWith('<')) {
            return block; 
        }
        return block
            .trim()
            .split(/\n\s*\n/) 
            .filter(p => p.trim())
            .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
            .join('');
    }).join('');
    
    return html.replace(/<\/ul><br>/g, '</ul>');
}

function renderChart(elementId, type, title, data) {
    const el = document.getElementById(elementId);
    if (!el || !(window as any).Plotly) return;

    try {
        const rows = data.trim().split('\n').map(row => row.split(',').map(cell => cell.trim()));
        const headers = rows.shift();
        
        const layout = {
            title: { text: title, font: { color: state.theme === 'dark' ? '#c9d1d9' : '#000000', family: 'Inter, sans-serif' } },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { color: state.theme === 'dark' ? '#8b949e' : '#6b7280', family: 'Inter, sans-serif' },
            xaxis: { gridcolor: state.theme === 'dark' ? '#30363d' : '#e5e7eb', linecolor: state.theme === 'dark' ? '#30363d' : '#d1d5db' },
            yaxis: { gridcolor: state.theme === 'dark' ? '#30363d' : '#e5e7eb', linecolor: state.theme === 'dark' ? '#30363d' : '#d1d5db' },
            yaxis2: { overlaying: 'y', side: 'right', gridcolor: 'transparent', linecolor: state.theme === 'dark' ? '#30363d' : '#d1d5db', showgrid: false },
            legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'right', x: 1 },
            margin: { l: 50, r: 50, b: 50, t: 50, pad: 4 }
        };

        let plotData;
        switch (type) {
            case 'bar-line-combo':
                plotData = [
                    { x: rows.map(r => r[0]), y: rows.map(r => parseFloat(r[1])), type: 'bar', name: headers[1], marker: { color: '#388bfd' } },
                    { x: rows.map(r => r[0]), y: rows.map(r => parseFloat(r[2])), type: 'scatter', mode: 'lines+markers', name: headers[2], yaxis: 'y2', marker: { color: '#e3b341' } }
                ];
                break;
            case 'line':
                plotData = headers.slice(1).map((header, i) => ({
                    x: rows.map(r => r[0]), y: rows.map(r => parseFloat(r[i + 1])), type: 'scatter', mode: 'lines', name: header
                }));
                break;
            case 'donut':
                plotData = [{
                    labels: rows.map(r => r[0]),
                    values: rows.map(r => parseInt(r[1])),
                    type: 'pie',
                    hole: .4,
                    textinfo: 'label+percent',
                    insidetextorientation: 'radial',
                    marker: { colors: ['#2da44e', '#e3b341', '#f85149'] } // Green, Gold, Red
                }];
                (layout as any).showlegend = false;
                break;
        }

        if (plotData) {
            (window as any).Plotly.newPlot(elementId, plotData, layout, {responsive: true, displaylogo: false});
        }
    } catch (error) {
        console.error("Failed to render chart:", error);
        el.innerHTML = `<p class="text-red-500 text-center">Could not render chart: Invalid data format.</p>`;
    }
}

function renderDiagram(type, data) {
    const items = data.trim().split('\n').map(item => item.trim().replace(/^\* ?-? ?/, ''));
    const diagramClass = `diagram-${type}`;

    return `
        <div class="diagram-container ${diagramClass}">
            ${items.map(item => `
                <div class="diagram-item">
                    <div class="diagram-item-connector"></div>
                    <div class="diagram-item-content">
                        ${item.replace(/(\d{4}:|[\w\s]+:)/, '<strong>$1</strong>')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function parsePitchDeckContent(text) {
    const slidesRaw = text.split(/\n(?=##?#? |Slide \d+:?)/).filter(s => s.trim());
    const slides = slidesRaw.map(slideText => {
        const lines = slideText.trim().split('\n');
        const title = lines.shift().replace(/##?#? ?|Slide \d+:? ?/g, '').trim();
        const content = lines.join('\n').trim();
        return { title, content };
    });
    return slides.length > 0 ? slides : [{ title: "Generated Content", content: text }];
}

function formatDateTime(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return 'N/A';
    }
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function attachAutocomplete(inputEl, onSelect) {
    inputEl.addEventListener('input', function() {
        const val = this.value;
        // Fix: Pass null to satisfy the function signature.
        closeAllLists(null);
        if (!val) { return false; }
        const suggestions = tickerList.filter(item => 
            item.ticker.toUpperCase().includes(val.toUpperCase()) || 
            item.name.toUpperCase().includes(val.toUpperCase())
        ).slice(0, 5);
        
        const list = document.createElement("div");
        list.setAttribute("class", "autocomplete-items");
        this.parentNode.appendChild(list);

        suggestions.forEach(item => {
            const itemEl = document.createElement("div");
            itemEl.setAttribute("class", "autocomplete-item");
            itemEl.innerHTML = `<span class="name">${item.name}</span><span class="ticker">${item.ticker}</span>`;
            itemEl.addEventListener("click", function() {
                inputEl.value = item.ticker;
                onSelect(item.ticker);
                closeAllLists(null);
            });
            list.appendChild(itemEl);
        });
    });
}
function closeAllLists(elmnt) {
    const items = document.getElementsByClassName("autocomplete-items");
    for (let i = 0; i < items.length; i++) {
        // Fix: Cast parentNode to Element to access getElementsByTagName.
        if (elmnt != items[i] && elmnt != (items[i].parentNode as Element).getElementsByTagName("input")[0]) {
            items[i].parentNode.removeChild(items[i]);
        }
    }
}
document.addEventListener("click", function (e) {
    closeAllLists(e.target);
});

function stopRealtimeUpdates() {
    if (realtimeIntervalId) {
        clearInterval(realtimeIntervalId);
        realtimeIntervalId = null;
    }
}

async function startRealtimeUpdates() {
    stopRealtimeUpdates(); 
    realtimeIntervalId = setInterval(async () => {
        if (state.currentView !== 'dashboard' || !state.ticker || !state.dashboardData) return;
        
        try {
            const oldPrice = state.dashboardData.quote.price;
            const newSummaryData = await apiService.getTickerSummary(state.ticker);

            if (state.realtimeStatus !== 'connected') {
                state.realtimeStatus = 'connected';
                renderHeader();
                addDashboardEventListeners();
            }

            state.dashboardData.quote = { ...state.dashboardData.quote, ...newSummaryData };
            const quote = state.dashboardData.quote;
            const newPrice = quote.price;
            
            checkPriceAlert();
            
            // Update Header
            const priceEl = document.getElementById('header-latest-price');
            const changeEl = document.querySelector('#price-quote .font-semibold');
            const sentimentTagEl = document.getElementById('sentiment-tag');

            if (priceEl && changeEl) {
                priceEl.textContent = `${formatterService.currency(newPrice)} USD`;
                changeEl.textContent = `${formatterService.currency(quote.change)} (${formatterService.percent(quote.changePercent / 100)})`;
                changeEl.className = `font-semibold ${quote.change >= 0 ? 'text-green-400' : 'text-red-400'}`;
                
                priceEl.classList.remove('flash-text-green', 'flash-text-red');
                void priceEl.offsetWidth; 
                
                if (newPrice > oldPrice) {
                    priceEl.classList.add('flash-text-green');
                } else if (newPrice < oldPrice) {
                    priceEl.classList.add('flash-text-red');
                }
            }

            if (sentimentTagEl) {
                const { sentiment, className, emoji } = getSentimentDetails(quote.changePercent);
                sentimentTagEl.className = `sentiment-tag ${className}`;
                sentimentTagEl.innerHTML = `${emoji} ${sentiment}`;
            }
            
            if(state.currentTab === 'valuation_models') {
                const dcfInputs = state.dashboardData.workflow.dcfValuation.inputs;
                const modelType = state.dashboardData.workflow.dcfValuation.modelType || 'Standard';

                const assumptions = modelType === 'Financials'
                    ? {
                        roe: dcfInputs.roe.value,
                        reinvestmentRate: dcfInputs.reinvestmentRate.value,
                        costOfEquity: dcfInputs.costOfEquity.value,
                        terminalGrowth: dcfInputs.terminalGrowth.value,
                    }
                    : {
                        revenueGrowth: dcfInputs.revenueGrowth.value,
                        operatingMargin: dcfInputs.operatingMargin.value,
                        taxRate: dcfInputs.taxRate.value,
                        reinvestmentRate: dcfInputs.reinvestmentRate.value,
                        wacc: dcfInputs.wacc.value,
                        terminalGrowth: dcfInputs.terminalGrowth.value,
                    };

                const dcfOutputs = calculateDcfOutputs(quote, assumptions);
                state.dashboardData.workflow.dcfValuation.outputs = dcfOutputs;
                const dcfSentiment = getDcfSentimentAndCommentary(dcfOutputs, quote);
                state.dashboardData.workflow.dcfValuation.sentiment = dcfSentiment.sentiment;
                state.dashboardData.workflow.dcfValuation.commentary = dcfSentiment.commentary;
                renderDcfOutputs();

                // Live LBO updates are complex; for now, a full recalc is disabled on tick to save API calls
                // A simple price update might be enough for the LBO purchase price display
                 const purchasePriceDisplay = document.getElementById('lbo-purchase-price-display');
                 if (purchasePriceDisplay) {
                     purchasePriceDisplay.textContent = formatterService.largeNumber(quote.marketCap);
                 }
            }

        } catch (error) {
            console.error("Real-time update failed:", error);
            if (state.realtimeStatus !== 'error') {
                state.realtimeStatus = 'error';
                renderHeader();
                addDashboardEventListeners();
            }
        }
    }, 30000); 
}

function checkPriceAlert() {
    const { alert, dashboardData, ticker } = state;
    if (!alert.active || alert.triggered || !dashboardData) return;

    const currentPrice = dashboardData.quote.price;
    let triggered = false;
    if (alert.direction === 'up' && currentPrice >= alert.target) {
        triggered = true;
    } else if (alert.direction === 'down' && currentPrice <= alert.target) {
        triggered = true;
    }

    if (triggered) {
        state.alert.triggered = true;
        new Notification('Pitchly Price Alert!', {
            body: `${ticker} crossed your target of $${alert.target.toFixed(2)}. Current price: $${currentPrice.toFixed(2)}.`,
            icon: apiService.getLogoUrl(ticker)
        });
        renderHeader(); 
        addDashboardEventListeners();
    }
}

function getSentimentDetails(changePercent) {
    if (typeof changePercent !== 'number') return { sentiment: 'Neutral', className: 'sentiment-neutral', emoji: '😐' };

    if (changePercent > 3) {
        return { sentiment: 'Bullish', className: 'sentiment-bullish', emoji: '📈' };
    } else if (changePercent < -3) {
        return { sentiment: 'Bearish', className: 'sentiment-bearish', emoji: '📉' };
    } else {
        return { sentiment: 'Neutral', className: 'sentiment-neutral', emoji: '😐' };
    }
}

// --- 7. EVENT HANDLERS ---
function addWelcomeEventListeners() {
    document.getElementById('launch-btn').addEventListener('click', handleLaunchDashboard);
    const welcomeInput = document.getElementById('welcome-ticker-input');
    welcomeInput.addEventListener('input', e => { state.welcomeTicker = (e.target as HTMLInputElement).value.toUpperCase(); });
    welcomeInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLaunchDashboard(); });
    attachAutocomplete(welcomeInput, (ticker) => {
        state.welcomeTicker = ticker.toUpperCase();
        (welcomeInput as HTMLInputElement).value = state.welcomeTicker;
    });
}
function addDashboardEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', handleNavClick));
    const switchBtn = document.getElementById('ticker-switch-btn');
    const switchInput = document.getElementById('ticker-switch-input') as HTMLInputElement;
    if (switchBtn && switchInput) {
        switchBtn.addEventListener('click', handleTickerSwitch);
        switchInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleTickerSwitch(); });
        attachAutocomplete(switchInput, (ticker) => {
            switchInput.value = ticker.toUpperCase();
            handleTickerSwitch();
        });
    }
    document.getElementById('back-btn')?.addEventListener('click', handleBackToReport);
    document.getElementById('copy-btn')?.addEventListener('click', handleCopy);
    
    document.getElementById('toggle-alert-btn')?.addEventListener('click', handleToggleAlertInput);
    document.getElementById('set-alert-btn')?.addEventListener('click', handleSetAlert);
    document.getElementById('clear-alert-btn')?.addEventListener('click', handleClearAlert);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', handleThemeToggle);
}

async function handleLaunchDashboard() {
    stopRealtimeUpdates();
    state.ticker = state.welcomeTicker;
    state.currentView = 'dashboard';
    state.alert = { target: null, active: false, triggered: false, direction: null };
    await fetchData(state.ticker);
    if (!state.error) {
        startRealtimeUpdates();
    }
}
async function handleTickerSwitch() {
    const newTicker = (document.getElementById('ticker-switch-input') as HTMLInputElement).value.toUpperCase();
    if (newTicker && newTicker !== state.ticker) {
        stopRealtimeUpdates();
        state.ticker = newTicker;
        state.analysisContent = {};
        state.pitchDeck = { currentSlide: 0, slides: [] };
        state.currentTab = 'valuation_models';
        state.alert = { target: null, active: false, triggered: false, direction: null };
        state.lboScenario = 'baseCase';
        await fetchData(newTicker);
         if (!state.error) {
            startRealtimeUpdates();
        }
    }
}
async function handleNavClick(event) {
    const key = (event.currentTarget as HTMLElement).dataset.tabKey;
    state.currentTab = key;
    const isAnalysisTab = !['valuation_models', 'peer_comparison'].includes(key);

    const analysisData = state.analysisContent[key];
    if (isAnalysisTab && (!analysisData || analysisData.ticker !== state.ticker)) {
        state.loading.analysis = true;
        renderContent(); // Show loading state
        try {
            const companyName = state.dashboardData?.quote?.companyName || state.ticker;
            const result = await generateAnalysis(state.ticker, companyName, key);
            state.analysisContent[key] = { ticker: state.ticker, content: result };
             if (key === 'pitch_deck' && result) {
                state.pitchDeck.slides = parsePitchDeckContent(result);
                state.pitchDeck.currentSlide = 0;
            }
        } catch (err) {
            state.analysisContent[key] = { ticker: state.ticker, content: `Error: ${(err as Error).message}`};
        } finally {
            state.loading.analysis = false;
        }
    }
    renderApp();
}

function runLboUpdate() {
    const workflow = state.dashboardData.workflow;
    if (!workflow) return;

    const scenario = state.lboScenario;
    const scenarioIndex = workflow.lboAnalysis.scenarios.findIndex(s => s.header.scenarioId === scenario);
    if (scenarioIndex === -1) return;

    const currentScenarioData = workflow.lboAnalysis.scenarios[scenarioIndex];
    const inputs = currentScenarioData.inputs;
    
    const assumptions = {
        purchasePrice: inputs.purchasePrice.value,
        debtFinancing: inputs.debtFinancing.value,
        interestRate: inputs.interestRate.value,
        ebitdaGrowth: inputs.ebitdaGrowth.value,
        exitMultiple: inputs.exitMultiple.value,
        holdingPeriod: inputs.holdingPeriod.value,
        ...(['dividendRecap', 'leveragedRecap'].includes(scenario) && {
            recapYear: inputs.recapYear.value,
            dividendPayout: inputs.dividendPayout.value,
        }),
        ...(scenario === 'mezzanineDebt' && {
            mezzanineFinancing: inputs.mezzanineFinancing.value,
            mezzanineInterestRate: inputs.mezzanineInterestRate.value,
        }),
    };

    const newCalculatedOutputs = calculateLboOutputs(state.dashboardData.quote, assumptions, scenario);
    const { sentiment, commentary } = getLboSentimentAndCommentary(newCalculatedOutputs.irr, newCalculatedOutputs.moic, scenario);
    
    // Update the specific scenario in the state
    const updatedScenario = workflow.lboAnalysis.scenarios[scenarioIndex];
    updatedScenario.outputs = {
        ebitda: newCalculatedOutputs.projections.map(p => p.ebitda),
        cashFlow: newCalculatedOutputs.projections.map(p => p.cashFlow),
        debtBalance: newCalculatedOutputs.projections.map(p => p.debtBalance),
        sponsorEquity: newCalculatedOutputs.initialEquity,
        seniorDebt: newCalculatedOutputs.initialSeniorDebt,
        mezzanineDebt: newCalculatedOutputs.initialMezzanineDebt,
        exitEquityValue: newCalculatedOutputs.exitEquityValue,
        irr: newCalculatedOutputs.irr,
        moic: newCalculatedOutputs.moic,
        dividendPaid: newCalculatedOutputs.dividendPaid,
    };
    updatedScenario.header.badge = sentiment.badge;
    updatedScenario.sentiment = sentiment.badge;
    updatedScenario.commentary = commentary.text;

    renderLboOutputs();
    
    const purchasePriceDisplay = document.getElementById('lbo-purchase-price-display');
    if (purchasePriceDisplay) {
        purchasePriceDisplay.textContent = formatterService.largeNumber(assumptions.purchasePrice);
    }
}


function handleModelInputChange(event) {
    const target = event.target as HTMLInputElement;
    if (!target.classList.contains('model-slider')) return;
    
    const modelType = target.dataset.model; // 'dcf' or 'lbo'
    const inputIdRaw = target.id.split('-').slice(1).join('');
    const inputId = inputIdRaw.charAt(0).toLowerCase() + inputIdRaw.slice(1);
    const value = parseFloat(target.value);
    
    const workflow = state.dashboardData.workflow;
    if (!workflow) return;

    if (modelType === 'dcf') {
        const dcfData = workflow.dcfValuation;
        dcfData.inputs[inputId].value = value;
        
        const assumptions = dcfData.modelType === 'Financials'
            ? { // Financials model assumptions
                roe: dcfData.inputs.roe.value,
                reinvestmentRate: dcfData.inputs.reinvestmentRate.value,
                costOfEquity: dcfData.inputs.costOfEquity.value,
                terminalGrowth: dcfData.inputs.terminalGrowth.value,
            }
            : { // Standard model assumptions
                revenueGrowth: dcfData.inputs.revenueGrowth.value,
                operatingMargin: dcfData.inputs.operatingMargin.value,
                taxRate: dcfData.inputs.taxRate.value,
                reinvestmentRate: dcfData.inputs.reinvestmentRate.value,
                wacc: dcfData.inputs.wacc.value,
                terminalGrowth: dcfData.inputs.terminalGrowth.value,
            };

        const newOutputs = calculateDcfOutputs(state.dashboardData.quote, assumptions);
        dcfData.outputs = newOutputs;
        const { sentiment, commentary } = getDcfSentimentAndCommentary(newOutputs, state.dashboardData.quote);
        dcfData.sentiment = sentiment;
        dcfData.commentary = commentary;

        const formatter = ['holdingPeriod', 'recapYear'].includes(inputId)
            ? (v) => `${v}`
            : formatterService.percent;
        document.getElementById(`dcf-${inputId}-value`).textContent = formatter(value);
        renderDcfOutputs();

    } else if (modelType === 'lbo') {
        const scenario = state.lboScenario;
        const scenarioData = workflow.lboAnalysis.scenarios.find(s => s.header.scenarioId === scenario);
        if (scenarioData) {
            scenarioData.inputs[inputId].value = value;
            const formatter = inputId === 'exitMultiple' ? (v) => formatterService.ratio(v) 
                            : ['holdingPeriod', 'recapYear'].includes(inputId) ? (v) => `${v}`
                            : formatterService.percent;
            document.getElementById(`lbo-${inputId}-value`).textContent = formatter(value);
            runLboUpdate();
        }
    }
}

async function handleLboScenarioChange(event) {
    const newScenario = (event.target as HTMLSelectElement).value;
    state.lboScenario = newScenario;
    // Data is already generated, just re-render the card with the selected scenario
    renderLboCard('lbo-model-container');
}


function handleBackToReport() {
    state.currentTab = 'valuation_models';
    renderApp();
}
function handleCopy() {
    const content = document.querySelector('.prose-custom') as HTMLElement;
    const button = document.getElementById('copy-btn');
    if (content && button) {
        navigator.clipboard.writeText(content.innerText).then(() => {
            button.textContent = 'Copied!';
            setTimeout(() => { button.textContent = 'Copy'; }, 2000);
        });
    }
}
function handlePeerSort(column) {
    if (state.peerSort.column === column) {
        state.peerSort.direction = state.peerSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        state.peerSort.column = column;
        state.peerSort.direction = 'desc';
    }
    renderApp();
}

function handleToggleAlertInput() {
    state.showAlertInput = !state.showAlertInput;
    renderApp();
}

async function handleSetAlert() {
    const input = document.getElementById('alert-price-input') as HTMLInputElement;
    const targetPrice = parseFloat(input.value);
    if (isNaN(targetPrice) || targetPrice <= 0) {
        alert("Please enter a valid price.");
        return;
    }

    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }

    if (Notification.permission === 'denied') {
        alert("Notifications are blocked. Please enable them in your browser settings to use price alerts.");
        return;
    }

    const currentPrice = state.dashboardData.quote.price;
    state.alert = {
        target: targetPrice,
        active: true,
        triggered: false,
        direction: targetPrice > currentPrice ? 'up' : 'down'
    };
    state.showAlertInput = false;
    renderApp();
}

function handleClearAlert() {
    state.alert = { target: null, active: false, triggered: false, direction: null };
    state.showAlertInput = false;
    renderApp();
}

function handleExportPeersToCSV() {
    const data = state.dashboardData;
    if (!data || !data.peers || !data.workflow.peerComparison) return;

    const mainTickerData = data.quote;
    const peerComparison = data.workflow.peerComparison;
    
    const allCompanies = [mainTickerData, ...data.peers].map(p => {
         const positionData = peerComparison.outputs.positions[p.ticker] || {};
         const evEbitda = (p.ebitda && p.ebitda > 0) ? p.marketCap / p.ebitda : null;
         return {
            companyName: p.companyName,
            ticker: p.ticker,
            marketCap: p.marketCap,
            ebitda: p.ebitda,
            revenueGrowth: p.revenueGrowth,
            peRatio: p.peRatio,
            evEbitda: evEbitda,
            pePosition: positionData['P/E'],
            evEbitdaPosition: positionData['EV/EBITDA'],
        };
    });

    const headers = ['Company Name', 'Ticker', 'Market Cap (USD)', 'EBITDA (USD)', 'Revenue Growth (%)', 'P/E Ratio', 'EV/EBITDA'];
    const rows = allCompanies.map(c => [
        `"${c.companyName.replace(/"/g, '""')}"`,
        c.ticker,
        c.marketCap || 'N/A',
        c.ebitda || 'N/A',
        c.revenueGrowth ? (c.revenueGrowth * 100).toFixed(2) : 'N/A',
        c.peRatio ? c.peRatio.toFixed(2) : 'N/A',
        c.evEbitda ? c.evEbitda.toFixed(2) : 'N/A'
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${state.ticker}_peer_comparison.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function handlePrevSlide() {
    if (state.pitchDeck.currentSlide > 0) {
        state.pitchDeck.currentSlide--;
        renderPitchDeckView(document.getElementById('content-container'));
    }
}

function handleNextSlide() {
    if (state.pitchDeck.currentSlide < state.pitchDeck.slides.length - 1) {
        state.pitchDeck.currentSlide++;
        renderPitchDeckView(document.getElementById('content-container'));
    }
}

function handleCopySlide() {
    const currentSlide = state.pitchDeck.slides[state.pitchDeck.currentSlide];
    const button = document.getElementById('copy-slide-btn');
    if (currentSlide && button) {
        const textToCopy = `${currentSlide.title}\n\n${currentSlide.content}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = button.innerHTML;
            button.textContent = 'Copied!';
            setTimeout(() => { button.innerHTML = originalText; }, 2000);
        });
    }
}

function handleThemeToggle() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('banksmart-theme', state.theme);
    document.body.classList.toggle('dark-mode', state.theme === 'dark');
    renderHeader();
    addDashboardEventListeners();
    // Re-render current view to update charts with new theme
    if(state.currentView === 'dashboard') {
        renderContent();
    }
}


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.toggle('dark-mode', state.theme === 'dark');
    renderApp();
});