

import { GoogleGenAI } from "@google/genai";

// --- FIX: Declare Plotly to resolve 'Cannot find name' error, as it's likely loaded from a script tag. ---
declare var Plotly: any;

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

        // Handle objects like { raw, fmt } first.
        if (typeof value === 'object') {
            if (value.hasOwnProperty('raw') && typeof value.raw === 'number' && isFinite(value.raw)) {
                return value.raw;
            }
            return null; // It's an object, but not in a format we can parse.
        }

        if (typeof value === 'number') return isFinite(value) ? value : null;
        
        if (typeof value !== 'string' || value.trim() === '') return null;

        // Handle string formats with 'T', 'B', 'M' suffixes.
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
            valuationMethod: data.valuationMethod || (getTickerDomain(data.ticker) === 'Financials' ? 'DDM' : 'DCF'),
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
    welcomeTickerError: '',
    isWelcomeTickerValidating: false,
    tickerSwitchError: '',
    isTickerSwitchValidating: false,
    dashboardData: null, // Will hold { quote, peers, workflow }
    analysisContent: {}, // Ticker-keyed cache: { "TSLA": { swot: "...", memo: "..." } }
    pitchDeck: { ticker: null, currentSlide: 0, slides: [] },
    lboScenario: 'baseCase', // New state for LBO scenario
    loading: { data: false, analysis: false, lbo: false },
    error: null,
    peerSort: { column: 'marketCap', direction: 'desc' },
    alert: { target: null, active: false, triggered: false, direction: null },
    showAlertInput: false,
    realtimeStatus: 'connected', // 'connected', 'error', 'connecting'
    theme: 'dark', // 'dark' or 'light'
};
let realtimeIntervalId = null;
let postRenderCallbacks = [];

function setState(newState) {
    Object.assign(state, newState);
    renderApp();
    saveState();
}

function saveState() {
    try {
        const stateToSave = { ...state, dashboardData: null, loading: { data: false, analysis: false, lbo: false }, error: null, realtimeStatus: 'connected' };
        localStorage.setItem('pitchly-app-state', JSON.stringify(stateToSave));
    } catch (e) {
        console.error("Error saving state to localStorage:", e);
    }
}

function loadState() {
    try {
        const savedStateJSON = localStorage.getItem('pitchly-app-state');
        if (savedStateJSON) {
            const savedState = JSON.parse(savedStateJSON);
            // Don't load ephemeral state or view state to always start fresh
            delete savedState.currentView; // Always start at welcome page on refresh
            delete savedState.ticker;      // Always start at welcome page on refresh
            delete savedState.dashboardData;
            delete savedState.loading;
            delete savedState.error;
            delete savedState.realtimeStatus;
            delete savedState.isWelcomeTickerValidating;
            delete savedState.welcomeTickerError;
            delete savedState.isTickerSwitchValidating;
            delete savedState.tickerSwitchError;
            Object.assign(state, savedState);
        }
    } catch (e) {
        console.error("Error loading state from localStorage:", e);
    }
}


// --- 3. GEMINI API SERVICE ---
const API_KEY = process.env.API_KEY || "";
let ai;
if(API_KEY) ai = new GoogleGenAI({ apiKey: API_KEY });
const model = 'gemini-2.5-flash';

async function validateTickerWithGemini(ticker) {
    if (!ai) {
        console.warn("API_KEY not set, skipping AI validation.");
        return { valid: true }; // Fallback to allow regular API check
    }
    const prompt = `
        You are a financial data validation assistant. Your role is to determine if a given string is a valid, existing stock ticker symbol on a major exchange (like NASDAQ, NYSE, etc.).

        **Crucial Instruction:** You MUST distinguish between a company's common name and its actual ticker symbol. For example, "LG" is a company name, but its ticker might be "003550.KS" (LG Corp) or "LPL" (LG Display). The input string must be a valid ticker symbol itself, not the company name.

        Use your search capabilities to verify the ticker's existence.

        For the input string "${ticker}", respond with ONLY a single, valid JSON object:
        - If the string is a valid, existing ticker symbol: {"valid": true}
        - If the string is a company name, does not exist, or is improperly formatted: {"valid": false, "reason": "Provide a brief explanation, e.g., 'Ticker not found' or 'LG is a company name, not a ticker symbol. Try LPL or 003550.KS.'"}
    `;

    try {
        const response = await ai.models.generateContent({ model, contents: prompt, config: { tools: [{ googleSearch: {} }] } });
        let jsonString = response.text.trim();
        if (jsonString.startsWith("```json")) {
            jsonString = jsonString.substring(7, jsonString.length - 3).trim();
        }
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Failed to validate ticker with Gemini:", e);
        // If Gemini fails, fallback to the existing API check to avoid blocking the user.
        return { valid: true }; 
    }
}

async function generateAnalysis(ticker, companyName, type) {
    if (!ai) return "API_KEY is not set up. Cannot generate analysis.";
    const prompts = {
        swot: `As a strategy consultant, conduct a SWOT analysis for ${companyName} (${ticker}). Base your findings on current information from financial reports, news articles, and market analysis available on the web. Provide 2-3 distinct points for each category (Strengths, Weaknesses, Opportunities, Threats).`,
        memo: `Act as an investment banking associate. Draft a 1-page investment memo for ${companyName} (${ticker}). Your analysis must be grounded in real-time financial data, recent news, and market sentiment. Include: Company Overview, Investment Thesis, Financial Snapshot, Key Risks & Mitigants, and Exit Strategy.`,
        pitch_deck: `Act as a senior investment banking analyst creating a client-facing pitch deck for ${companyName} (${ticker}) suitable for senior executives.

**Global Instructions:**
- **Layouts:** For every slide, you **MUST** use a professional corporate slide layout. Instead of text placeholders like "[Visual: ...]", generate the actual data for the visual in a structured format. Use professional tables, charts with data, and diagrams with items.
- **Style:** The tone must be professional, clean, and corporate. The content should be boardroom-ready with a neutral color palette, consistent fonts, and balanced spacing.
- **Conciseness:** Keep each slide concise and visually polished.
- **Formatting:** Generate multiple slides using markdown. Each slide must have a clear title starting with '###'.
- **Consistency:** You **MUST** generate all 10 slides in the specified order. Do not skip slides, even if data is sparse. Populate all chart and diagram data with realistic, company-specific information based on your search capabilities; do not use the placeholder data provided in the examples.

**Required Slides & Visual Formats:**

### 1. ${companyName} (${ticker}) Company Overview
- Generate a clean overview with key facts (HQ, Founded, Employees), business model summary, and market positioning.
- **MUST** use a markdown table for the key facts.

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
- **MUST** summarize broker ratings in a professional markdown table with columns: Broker, Rating, Price Target.
- **MUST** include a sentiment chart data in this exact format, replacing placeholder values with realistic data for ${companyName}:
[CHART type="donut" title="Broker Rating Distribution"]
Rating,Count
Buy,12
Hold,8
Sell,2
[/CHART]

### 5. Trading Multiples
- **MUST** create a clean, professional markdown table comparing ${companyName} (${ticker}) to its peers.
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
- **MUST** provide a comparative overview of other key players in the sector using a markdown table.
- Highlight ${companyName} (${ticker})'s key differentiators and competitive positioning.

### 10. Management Team
- **MUST** create a clean, professional markdown table of the key management team.
- Include columns for Name, Title, and a brief note on their background or tenure.
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
    const { welcomeTicker, isWelcomeTickerValidating, welcomeTickerError } = state;

    const buttonDisabled = isWelcomeTickerValidating;
    const buttonClasses = `animated-launch-btn bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 px-6 rounded-lg ${buttonDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;
    const inputClasses = `flex-grow bg-gray-900 border-2 rounded-lg px-5 py-3 placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-amber-500/50 transition-all text-xl text-center font-mono tracking-widest uppercase ${welcomeTickerError ? 'border-red-500' : 'border-gray-600'}`;

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
                     <input id="welcome-ticker-input" value="${welcomeTicker}" type="text" placeholder="e.g., AAPL, TSLA" class="${inputClasses}">
                     <button id="launch-btn" class="${buttonClasses}" ${buttonDisabled ? 'disabled' : ''}>${isWelcomeTickerValidating ? 'Validating...' : 'Launch'}</button>
                </div>
                <div class="text-red-400 text-sm mt-2 text-left h-5">${welcomeTickerError}</div>
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

    // Common UI elements for the switch ticker functionality
    const { isTickerSwitchValidating, tickerSwitchError } = state;
    const switchButtonDisabled = isTickerSwitchValidating;
    const switchButtonClasses = `bg-gray-700 hover:bg-gray-600 font-semibold py-1.5 px-3 rounded-md text-sm ${switchButtonDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;
    const switchInputClasses = `bg-gray-900/50 border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 w-32 font-mono uppercase ${tickerSwitchError ? 'border-red-500' : 'border-gray-600'}`;

    const switchTickerUI = `
        <div class="relative">
            <div class="flex items-center gap-2 autocomplete">
                <input id="ticker-switch-input" type="text" placeholder="Switch Ticker" class="${switchInputClasses}">
                <button id="ticker-switch-btn" class="${switchButtonClasses}" ${switchButtonDisabled ? 'disabled' : ''}>${isTickerSwitchValidating ? '...' : 'Go'}</button>
            </div>
            ${tickerSwitchError ? `<div class="absolute top-full left-0 text-red-400 text-xs mt-1 w-full text-center">${tickerSwitchError}</div>` : ''}
        </div>
    `;

    // The right-hand side controls (connection, alert, theme, switch)
    const headerControls = `
        <div class="flex items-center gap-4">
            ${renderConnectionStatus()}
            ${renderAlertUI()}
            ${renderThemeToggle()}
            ${switchTickerUI}
        </div>
    `;

    let content;
    let mainContent;

    if (state.loading.data) {
        mainContent = `
            <div class="flex-grow">
                <p class="text-gray-400 animate-pulse">Loading data for ${state.ticker.toUpperCase()}...</p>
            </div>
        `;
    } else if (data) {
        const changeColor = data.change >= 0 ? 'text-green-400' : 'text-red-400';
        const { sentiment, className, emoji } = getSentimentDetails(data.changePercent);
        const sentimentTag = `<div id="sentiment-tag" class="sentiment-tag ${className}">${emoji} ${sentiment}</div>`;
        
        mainContent = `
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
        `;
    } else { // Error case
        mainContent = `
            <div class="flex-grow">
                 <p class="text-red-500">${state.error || `Could not load data for ${state.ticker.toUpperCase()}.`}</p>
            </div>
        `;
    }

    content = `
        <div class="flex flex-col md:flex-row items-center justify-between gap-4 glass-panel p-4 rounded-xl">
            ${mainContent}
            ${headerControls}
        </div>
    `;
    
    container.innerHTML = content;
}


function renderThemeToggle() {
    const isDark = state.theme === 'dark';
    const title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    const icon = isDark 
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.106a.75.75 0 010 1.06l-1.591 1.59a.75.75 0 11-1.06-1.06l1.59-1.591a.75.75 0 011.06 0zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.803 17.803a.75.75 0 01-1.06 0l-1.59-1.591a.75.75 0 111.06-1.06l1.59 1.59a.75.75 0 010 1.06zM12 21a.75.75 0 01-.75-.75v-2.25a.75.75 0 011.5 0V20.25a.75.75 0 01-.75-.75zM6.106 18.894a.75.75 0 011.06 0l1.59-1.59a.75.75 0 111.06 1.06l-1.59 1.591a.75.75 0 01-1.06 0zM3.75 12a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H4.5a.75.75 0 01-.75-.75zM6.106 6.106a.75.75 0 010-1.06l1.59-1.591a.75.75 0 011.06 1.06l-1.59 1.59a.75.75 0 01-1.06 0z" /></svg>`
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
    const modelType = dcfData.modelType;
    
    const renderSlider = (id, label, min, max, step, value, formatter) => `
        <div class="flex flex-col gap-1">
            <div class="flex justify-between text-sm">
                <label for="${id}" class="font-medium text-gray-300">${label}</label>
                <span id="${id}-value" class="font-mono text-amber-400">${formatter(value)}</span>
            </div>
            <input type="range" id="${id}" data-model="dcf" class="model-slider" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>`;

    let slidersHtml;
    if (modelType === 'DDM') {
        slidersHtml = `
            ${renderSlider('dcf-roe', 'Return on Equity (ROE)', dcfData.inputs.roe.min, dcfData.inputs.roe.max, dcfData.inputs.roe.step, dcfData.inputs.roe.value, formatterService.percent)}
            ${renderSlider('dcf-reinvestmentRate', 'Retention Ratio (1 - Payout)', dcfData.inputs.reinvestmentRate.min, dcfData.inputs.reinvestmentRate.max, dcfData.inputs.reinvestmentRate.step, dcfData.inputs.reinvestmentRate.value, formatterService.percent)}
            ${renderSlider('dcf-costOfEquity', 'Cost of Equity', dcfData.inputs.costOfEquity.min, dcfData.inputs.costOfEquity.max, dcfData.inputs.costOfEquity.step, dcfData.inputs.costOfEquity.value, formatterService.percent)}
            ${renderSlider('dcf-terminalGrowth', 'Terminal Growth', dcfData.inputs.terminalGrowth.min, dcfData.inputs.terminalGrowth.max, dcfData.inputs.terminalGrowth.step, dcfData.inputs.terminalGrowth.value, formatterService.percent)}
        `;
    } else { // DCF Model
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
    document.getElementById('dcf-inputs')?.addEventListener('input', handleModelInputChange);
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
    document.getElementById('lbo-inputs')?.addEventListener('input', handleModelInputChange);
    document.getElementById('lbo-scenario-select')?.addEventListener('change', handleLboScenarioChange);
}

function renderIndividualAnalysisView(container, type) {
    const cachedTickerContent = state.analysisContent[state.ticker] || {};
    const content = cachedTickerContent[type];
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

    if (pitchDeck.ticker && pitchDeck.ticker !== ticker) {
        container.innerHTML = `<div class="text-center p-10 glass-panel rounded-xl"><p>Stale pitch deck data. Please click the tab again to refresh.</p></div>`;
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
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4"><path d="M5.5 2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-5ZM5 2a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 10 .5v1a.5.5 0 0 0 1 0v-1A2.5 2.5 0 0 0 8.5 0h-2A2.5 2.5 0 0 0 4 2.5v1a.5.5 0 0 0 1 0v-1.5Z"/></svg>
                        Copy Slide
                    </button>
                    <span class="slide-counter">${pitchDeck.currentSlide + 1} / ${pitchDeck.slides.length}</span>
                </div>
            </header>
            <main class="pitch-deck-slide">
                <h1 class="slide-title">${currentSlide.title}</h1>
                <div class="slide-body prose-custom">${contentHtml}</div>
            </main>
            <footer class="pitch-deck-footer">
                <p class="confidential-note">Confidential and for discussion purposes only.</p>
                <div class="flex items-center gap-3">
                    <button id="prev-slide-btn" class="slide-nav-btn" ${pitchDeck.currentSlide === 0 ? 'disabled' : ''}>&larr; Previous</button>
                    <button id="next-slide-btn" class="slide-nav-btn" ${pitchDeck.currentSlide === pitchDeck.slides.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
                </div>
            </footer>
        </div>
    `;

    postRenderCallbacks.forEach(cb => cb());
    postRenderCallbacks = [];
}

function renderPeerComparisonView(container) {
    const { peers } = state.dashboardData;
    const { column, direction } = state.peerSort;
    
    if (!peers || peers.length === 0) {
        container.innerHTML = `<div class="glass-panel rounded-xl p-6 text-center"><p>No peer data available for ${state.ticker}.</p></div>`;
        return;
    }
    
    const sortedPeers = [...peers].sort((a, b) => {
        const valA = a[column] || 0;
        const valB = b[column] || 0;
        return direction === 'asc' ? valA - valB : valB - valA;
    });
    
    const getSortArrow = (col) => {
        if (col !== column) return '';
        return direction === 'asc' ? ' &uarr;' : ' &darr;';
    };

    const findMinMax = (key) => {
        const values = peers.map(p => p[key]).filter(v => v !== null && !isNaN(v));
        return { min: Math.min(...values), max: Math.max(...values) };
    };
    
    const ranges = {
        marketCap: findMinMax('marketCap'), revenue: findMinMax('revenue'),
        peRatio: findMinMax('peRatio'), psRatio: findMinMax('psRatio'),
        revenueGrowth: findMinMax('revenueGrowth'), evEbitda: findMinMax('evEbitda')
    };

    const renderMiniBar = (value, range) => {
        if (value === null || isNaN(value)) return 'N/A';
        const isNegative = value < 0;
        const absValue = Math.abs(value);
        const absMax = Math.max(Math.abs(range.min), Math.abs(range.max));
        const width = absMax > 0 ? (absValue / absMax) * 100 : 0;

        return `
            <div class="flex items-center gap-2">
                <span class="w-16 text-right">${formatterService.ratio(value, '')}</span>
                <div class="mini-bar-container">
                    <div class="mini-bar ${isNegative ? 'negative' : 'positive'}" style="width: ${width}%;"></div>
                </div>
            </div>`;
    };

    container.innerHTML = `
        <div class="glass-panel rounded-xl p-4 md:p-6 fade-in">
            <h2 class="text-xl font-semibold mb-4">Competitor Benchmarks</h2>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left peer-table">
                    <thead class="text-xs text-gray-400 uppercase">
                        <tr>
                            <th class="py-3 px-4">Company</th>
                            <th class="py-3 px-4 text-right sortable-header ${column === 'marketCap' ? direction : ''}" data-sort="marketCap">Market Cap${getSortArrow('marketCap')}</th>
                            <th class="py-3 px-4 text-right sortable-header ${column === 'revenue' ? direction : ''}" data-sort="revenue">Revenue${getSortArrow('revenue')}</th>
                            <th class="py-3 px-4 text-right sortable-header ${column === 'peRatio' ? direction : ''}" data-sort="peRatio">P/E Ratio${getSortArrow('peRatio')}</th>
                            <th class="py-3 px-4 text-right sortable-header ${column === 'psRatio' ? direction : ''}" data-sort="psRatio">P/S Ratio${getSortArrow('psRatio')}</th>
                            <th class="py-3 px-4 text-right sortable-header ${column === 'evEbitda' ? direction : ''}" data-sort="evEbitda">EV/EBITDA${getSortArrow('evEbitda')}</th>
                            <th class="py-3 px-4 text-right sortable-header ${column === 'revenueGrowth' ? direction : ''}" data-sort="revenueGrowth">Rev. Growth${getSortArrow('revenueGrowth')}</th>
                        </tr>
                    </thead>
                    <tbody class="font-mono">
                    ${sortedPeers.map(peer => `
                        <tr class="${peer.ticker === state.ticker ? 'highlight-row' : ''}">
                            <td class="py-3 px-4">
                                <div class="flex items-center gap-3">
                                    <img src="${peer.logoUrl || apiService.getLogoUrl(peer.ticker)}" class="h-6 w-6 object-contain bg-white/90 p-0.5 rounded-full" alt="${peer.ticker} logo">
                                    <div>
                                        <div class="font-bold text-primary">${peer.ticker}</div>
                                        <div class="text-xs text-gray-400 truncate max-w-[120px]">${peer.companyName}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="py-3 px-4 text-right">${formatterService.largeNumber(peer.marketCap)}</td>
                            <td class="py-3 px-4 text-right">${formatterService.largeNumber(peer.revenue)}</td>
                            <td class="py-3 px-4 text-right">${formatterService.ratio(peer.peRatio)}</td>
                            <td class="py-3 px-4 text-right">${formatterService.ratio(peer.psRatio)}</td>
                            <td class="py-3 px-4 text-right">${formatterService.ratio(peer.evEbitda)}</td>
                            <td class="py-3 px-4 text-right">${formatterService.percent(peer.revenueGrowth)}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderDcfOutputs() {
    const container = document.getElementById('dcf-summary-container');
    if (!container || !state.dashboardData) return;
    
    const dcfData = state.dashboardData.workflow.dcfValuation;
    const { price } = state.dashboardData.quote;
    const { impliedSharePrice, premium, enterpriseValue, equityValue } = dcfData.outputs;

    const premiumColor = premium >= 0 ? 'text-green-400' : 'text-red-400';
    
    container.innerHTML = `
        <div class="flex justify-between items-center border-b border-gray-700 pb-2">
            <span class="text-gray-400">Current Share Price:</span>
            <span>${formatterService.currency(price)}</span>
        </div>
        <div class="flex justify-between items-center text-lg font-bold text-amber-400 pt-2">
            <span>Implied Share Price:</span>
            <span>${formatterService.currency(impliedSharePrice)}</span>
        </div>
        <div class="flex justify-between items-center text-sm ${premiumColor} font-semibold">
            <span>Upside / Downside:</span>
            <span>${formatterService.percent(premium)}</span>
        </div>
        <div class="pt-3 border-t border-gray-700 mt-3 space-y-2">
            <div class="flex justify-between items-center">
                <span class="text-gray-400">Enterprise Value:</span>
                <span>${formatterService.largeNumber(enterpriseValue)}</span>
            </div>
            <div class="flex justify-between items-center">
                <span class="text-gray-400">Equity Value:</span>
                <span>${formatterService.largeNumber(equityValue)}</span>
            </div>
        </div>
    `;
}


function renderLboOutputs() {
    const tableContainer = document.getElementById('lbo-projections-table');
    const summaryContainer = document.getElementById('lbo-summary-container');
    if (!tableContainer || !summaryContainer || !state.dashboardData) return;

    const allLboScenarios = state.dashboardData.workflow.lboAnalysis.scenarios;
    const lboData = allLboScenarios.find(s => s.header.scenarioId === state.lboScenario);
    
    if (!lboData) return;
    
    const { projections, returns } = lboData.outputs;

    tableContainer.innerHTML = projections.map(p => `
        <tr>
            <td class="py-2 px-3 text-center">${p.year}</td>
            <td class="py-2 px-3 text-right">${formatterService.largeNumber(p.ebitda)}</td>
            <td class="py-2 px-3 text-right">${formatterService.largeNumber(p.cashFlow)}</td>
            <td class="py-2 px-3 text-right">${formatterService.largeNumber(p.endingDebt)}</td>
        </tr>
    `).join('');
    
    summaryContainer.innerHTML = `
        <div class="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm">
            <div class="flex justify-between items-center"><span class="text-gray-400">Entry Equity:</span><span>${formatterService.largeNumber(returns.entryEquity)}</span></div>
            <div class="flex justify-between items-center"><span class="text-gray-400">Exit Equity:</span><span>${formatterService.largeNumber(returns.exitEquity)}</span></div>
            <div class="flex justify-between items-center font-bold text-amber-400 text-base pt-1 border-t border-gray-700 mt-1 col-span-2">
                <span>IRR:</span>
                <span>${formatterService.percent(returns.irr)}</span>
            </div>
            <div class="flex justify-between items-center font-bold text-cyan-400 text-base col-span-2">
                <span>MOIC:</span>
                <span>${formatterService.ratio(returns.moic)}</span>
            </div>
        </div>
    `;
}

function simpleMarkdownToHtml(markdown) {
    if (!markdown) return '';
    let html = markdown;

    // Handle charts [CHART type="..." title="..."]...[/CHART]
    html = html.replace(/\[CHART type="([^"]+)" title="([^"]+)"\]\n?([\s\S]+?)\[\/CHART\]/g, (match, type, title, data) => {
        const id = `chart-${Math.random().toString(36).substring(7)}`;
        postRenderCallbacks.push(() => {
            const lines = data.trim().split('\n');
            const header = lines[0].split(',');
            const rows = lines.slice(1).map(line => line.split(','));
            
            const plotData = [];
            if (type === 'line' || type === 'bar') {
                for (let i = 1; i < header.length; i++) {
                    plotData.push({
                        x: rows.map(r => r[0]),
                        y: rows.map(r => parseFloat(r[i])),
                        name: header[i],
                        type: type
                    });
                }
            } else if (type === 'bar-line-combo') {
                // Assumes 1st series is bar, 2nd is line
                plotData.push({ x: rows.map(r => r[0]), y: rows.map(r => parseFloat(r[1])), name: header[1], type: 'bar' });
                plotData.push({ x: rows.map(r => r[0]), y: rows.map(r => parseFloat(r[2])), name: header[2], type: 'scatter', mode: 'lines', yaxis: 'y2' });
            } else if (type === 'donut') {
                 plotData.push({
                    labels: rows.map(r => r[0]),
                    values: rows.map(r => parseInt(r[1], 10)),
                    hole: .4,
                    type: 'pie'
                });
            }

            const layout = {
                title: { text: title, font: { color: 'var(--text-primary)' } },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                font: { color: 'var(--text-secondary)', family: 'Inter, sans-serif' },
                xaxis: { gridcolor: 'var(--border-primary)', linecolor: 'var(--border-primary)' },
                yaxis: { title: header.length > 2 && header[1].includes('USD') ? 'USD (Millions)' : '', gridcolor: 'var(--border-primary)', linecolor: 'var(--border-primary)' },
                yaxis2: type === 'bar-line-combo' ? { title: header[2], overlaying: 'y', side: 'right', showgrid: false, linecolor: 'var(--border-primary)' } : {},
                legend: { orientation: 'h', y: -0.2, x: 0.5, xanchor: 'center' },
                margin: { l: 60, r: 60, b: 80, t: 60, pad: 4 }
            };
            
            const config = { responsive: true };
            
            const chartEl = document.getElementById(id);
            // --- FIX: Check for Plotly existence before using it. ---
            if (chartEl && typeof Plotly !== 'undefined') Plotly.newPlot(id, plotData, layout, config);
        });
        return `<div id="${id}" class="chart-container"></div>`;
    });
    
    // Handle diagrams [DIAGRAM type="..."]...[/DIAGRAM]
    html = html.replace(/\[DIAGRAM type="([^"]+)"\]\n?([\s\S]+?)\[\/DIAGRAM\]/g, (match, type, data) => {
        const items = data.trim().split('\n').map(item => {
            const parts = item.split(':');
            return {
                label: parts.length > 1 ? `<strong>${parts[0].trim()}:</strong>` : '',
                text: parts.length > 1 ? parts.slice(1).join(':').trim() : parts[0].trim()
            };
        });
        return `
            <div class="diagram-container diagram-${type}">
                ${items.map(item => `
                    <div class="diagram-item">
                        <div class="diagram-item-connector"></div>
                        <div class="diagram-item-content">
                            ${item.label} ${item.text}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    });
    
    // Basic markdown
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
               .replace(/^## (.*$)/gim, '<h2>$1</h2>')
               .replace(/^# (.*$)/gim, '<h1>$1</h1>')
               .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
               .replace(/\*(.*)\*/g, '<em>$1</em>')
               .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>')
               .replace(/<\/ul>\n<ul>/g, '') // Combine consecutive lists
               .replace(/\n/g, '<br>');

    // Table markdown
    const tableRegex = /(\|.*\|(?:\r|\n|)?)+/g;
    html = html.replace(tableRegex, (table) => {
        const rows = table.trim().split('\n');
        const header = rows[0].split('|').slice(1, -1).map(h => `<th>${h.trim()}</th>`).join('');
        // Skip separator line
        const body = rows.slice(2).map(row => {
            const cells = row.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`.replace(/<br>/g, ''); // Remove br tags inside tables
    });
    
    return html.replace(/<br>\s*<h[1-3]>/g, '<h$1>').replace(/<br>\s*<(ul|table)>/g, '<$1>');
}

function getSentimentDetails(changePercent) {
    if (changePercent > 0.02) return { sentiment: 'Strongly Bullish', className: 'sentiment-bullish', emoji: '🚀' };
    if (changePercent > 0) return { sentiment: 'Bullish', className: 'sentiment-bullish', emoji: '📈' };
    if (changePercent < -0.02) return { sentiment: 'Strongly Bearish', className: 'sentiment-bearish', emoji: '🔥' };
    if (changePercent < 0) return { sentiment: 'Bearish', className: 'sentiment-bearish', emoji: '📉' };
    return { sentiment: 'Neutral', className: 'sentiment-neutral', emoji: '☕' };
}

// --- 6. EVENT LISTENERS & HANDLERS ---
function addWelcomeEventListeners() {
    document.getElementById('launch-btn')?.addEventListener('click', handleLaunch);
    const input = document.getElementById('welcome-ticker-input') as HTMLInputElement;
    input?.addEventListener('input', handleWelcomeTickerInput);
    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLaunch();
    });
    autocomplete(input, tickerList);
}

function addDashboardEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', handleTabClick));
    document.getElementById('back-btn')?.addEventListener('click', () => setState({ currentTab: 'valuation_models' }));
    document.getElementById('copy-btn')?.addEventListener('click', () => {
        const content = state.analysisContent[state.ticker]?.[state.currentTab];
        if (content) {
            navigator.clipboard.writeText(content);
            const btn = document.getElementById('copy-btn');
            if (btn) {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
            }
        }
    });

    document.querySelectorAll('.peer-table .sortable-header').forEach(header => {
        header.addEventListener('click', handlePeerSort);
    });
    
    document.getElementById('theme-toggle-btn')?.addEventListener('click', handleThemeToggle);
    
    // Alert UI listeners
    document.getElementById('toggle-alert-btn')?.addEventListener('click', handleAlertToggle);
    document.getElementById('set-alert-btn')?.addEventListener('click', handleSetAlert);
    document.getElementById('clear-alert-btn')?.addEventListener('click', handleClearAlert);
    
    // Pitch Deck listeners
    document.getElementById('prev-slide-btn')?.addEventListener('click', () => handlePitchDeckNav('prev'));
    document.getElementById('next-slide-btn')?.addEventListener('click', () => handlePitchDeckNav('next'));
    document.getElementById('copy-slide-btn')?.addEventListener('click', handleCopySlide);
    
    // Ticker Switch listeners
    document.getElementById('ticker-switch-btn')?.addEventListener('click', handleTickerSwitch);
    const switchInput = document.getElementById('ticker-switch-input') as HTMLInputElement;
    switchInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleTickerSwitch();
    });
    autocomplete(switchInput, tickerList);
}

// --- FIX: Add type to event object and cast e.target to HTMLInputElement to safely access 'value'. ---
function handleWelcomeTickerInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    setState({ welcomeTicker: value, welcomeTickerError: '' });
}

async function handleLaunch() {
    if (state.isWelcomeTickerValidating) return;

    const ticker = state.welcomeTicker.trim().toUpperCase();
    if (!ticker) {
        setState({ welcomeTickerError: 'Please enter a ticker.' });
        return;
    }

    setState({ isWelcomeTickerValidating: true, welcomeTickerError: '' });

    // 1. Basic format validation
    const tickerRegex = /^[A-Z0-9.-]+$/;
    if (!tickerRegex.test(ticker)) {
        setState({ welcomeTickerError: 'Invalid ticker format.', isWelcomeTickerValidating: false });
        return;
    }

    // 2. Gemini validation
    const validationResult = await validateTickerWithGemini(ticker);
    if (!validationResult.valid) {
        setState({ welcomeTickerError: validationResult.reason || 'Invalid or non-existent ticker.', isWelcomeTickerValidating: false });
        return;
    }

    // 3. Data load
    try {
        await initData(ticker);
        setState({ currentView: 'dashboard', isWelcomeTickerValidating: false });
    } catch (e) {
        setState({ welcomeTickerError: e.message || `Failed to load data for ${ticker}.`, isWelcomeTickerValidating: false });
    }
}

async function handleTickerSwitch() {
    // --- FIX: Cast HTMLElement to HTMLInputElement to safely access 'value'. ---
    const input = document.getElementById('ticker-switch-input') as HTMLInputElement;
    const ticker = input.value.trim().toUpperCase();
    
    if (state.isTickerSwitchValidating || !ticker || ticker === state.ticker) {
        if (!ticker) setState({ tickerSwitchError: '', isTickerSwitchValidating: false });
        return;
    }

    setState({ isTickerSwitchValidating: true, tickerSwitchError: '' });
    
    const tickerRegex = /^[A-Z0-9.-]+$/;
    if (!tickerRegex.test(ticker)) {
        setState({ tickerSwitchError: 'Invalid format.', isTickerSwitchValidating: false });
        return;
    }
    
    const validationResult = await validateTickerWithGemini(ticker);
    if (!validationResult.valid) {
        setState({ tickerSwitchError: validationResult.reason || 'Invalid ticker.', isTickerSwitchValidating: false });
        return;
    }
    
    try {
        await initData(ticker);
        input.value = '';
        setState({ isTickerSwitchValidating: false, tickerSwitchError: '' });
    } catch (e) {
        setState({ tickerSwitchError: e.message || `Failed to load ${ticker}.`, isTickerSwitchValidating: false });
    }
}

async function handleTabClick(e: Event) {
    const key = (e.currentTarget as HTMLElement).dataset.tabKey;
    if (state.currentTab === key) return;

    setState({ currentTab: key });
    
    if (['swot', 'memo', 'news'].includes(key)) {
        const analysisCache = state.analysisContent[state.ticker] || {};
        if (!analysisCache[key]) {
            setState({ loading: { ...state.loading, analysis: true } });
            try {
                const content = await generateAnalysis(state.ticker, state.dashboardData.quote.companyName, key);
                setState({
                    analysisContent: {
                        ...state.analysisContent,
                        [state.ticker]: { ...analysisCache, [key]: content }
                    },
                    loading: { ...state.loading, analysis: false }
                });
            } catch (error) {
                console.error(`Error generating ${key}:`, error);
                setState({ loading: { ...state.loading, analysis: false }, error: `Failed to generate ${key}.` });
            }
        }
    } else if (key === 'pitch_deck') {
        const { pitchDeck, ticker, dashboardData } = state;
        if (pitchDeck.ticker !== ticker) {
             setState({ loading: { ...state.loading, analysis: true } });
             try {
                const content = await generateAnalysis(ticker, dashboardData.quote.companyName, 'pitch_deck');
                const slides = content.split('### ').slice(1).map((slideContent, index) => {
                    const lines = slideContent.trim().split('\n');
                    return {
                        id: index,
                        title: lines[0].trim(),
                        content: lines.slice(1).join('\n').trim()
                    };
                });

                setState({
                    pitchDeck: { ticker, slides, currentSlide: 0 },
                    loading: { ...state.loading, analysis: false }
                });
            } catch (error) {
                console.error(`Error generating pitch deck:`, error);
                setState({ loading: { ...state.loading, analysis: false }, error: `Failed to generate pitch deck.` });
            }
        }
    }
}

// --- FIX: Add type to event object and cast e.target to HTMLInputElement for type safety. ---
function handleModelInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.type !== 'range') return;
    
    const sliderId = target.id;
    const modelType = target.dataset.model;
    const value = parseFloat(target.value);
    const [model, inputKey] = sliderId.split('-');

    let modelData, formatter;
    if (modelType === 'dcf') {
        modelData = state.dashboardData.workflow.dcfValuation;
        formatter = modelData.inputs[inputKey].value > 1 ? (v) => v.toFixed(2) : formatterService.percent;
    } else { // lbo
        const allScenarios = state.dashboardData.workflow.lboAnalysis.scenarios;
        const currentScenario = allScenarios.find(s => s.header.scenarioId === state.lboScenario);
        modelData = currentScenario;
        formatter = (v) => {
            if (inputKey === 'exitMultiple') return formatterService.ratio(v);
            if (inputKey.includes('Period') || inputKey.includes('Year')) return v.toString();
            return formatterService.percent(v);
        };
    }
    
    modelData.inputs[inputKey].value = value;
    document.getElementById(`${sliderId}-value`).textContent = formatter(value);
    
    if (modelType === 'dcf') {
        // Here you would call a function to recalculate DCF outputs
        // For now, let's assume a backend would do this. We'll simulate.
        // This recalculation logic should eventually live in a service worker or backend.
        // For simplicity, we are not recalculating on the fly.
        // renderDcfOutputs();
    } else {
        // renderLboOutputs();
    }
}

// --- FIX: Add type to event object and cast e.target to HTMLSelectElement to safely access 'value'. ---
function handleLboScenarioChange(e: Event) {
    const newScenarioId = (e.target as HTMLSelectElement).value;
    setState({ lboScenario: newScenarioId });
}

function handlePeerSort(e: MouseEvent) {
    const newColumn = (e.currentTarget as HTMLElement).dataset.sort;
    let newDirection = 'desc';
    if (state.peerSort.column === newColumn && state.peerSort.direction === 'desc') {
        newDirection = 'asc';
    }
    setState({ peerSort: { column: newColumn, direction: newDirection } });
}

function handleThemeToggle() {
    const newTheme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('dark-mode', newTheme === 'dark');
    setState({ theme: newTheme });
}

function handleAlertToggle() {
    setState({ showAlertInput: !state.showAlertInput });
}

function handleSetAlert() {
    // --- FIX: Cast HTMLElement to HTMLInputElement to safely access 'value'. ---
    const input = document.getElementById('alert-price-input') as HTMLInputElement;
    const targetPrice = parseFloat(input.value);
    if (!isNaN(targetPrice) && targetPrice > 0) {
        const currentPrice = state.dashboardData.quote.price;
        setState({
            alert: {
                target: targetPrice,
                active: true,
                triggered: false,
                direction: targetPrice > currentPrice ? 'up' : 'down'
            },
            showAlertInput: false
        });
    }
}

function handleClearAlert() {
    setState({
        alert: { target: null, active: false, triggered: false, direction: null },
        showAlertInput: false
    });
}

function handlePitchDeckNav(direction) {
    const { currentSlide, slides } = state.pitchDeck;
    const newSlide = direction === 'next' ? currentSlide + 1 : currentSlide - 1;
    if (newSlide >= 0 && newSlide < slides.length) {
        setState({ pitchDeck: { ...state.pitchDeck, currentSlide: newSlide } });
    }
}

function handleCopySlide() {
    const currentSlide = state.pitchDeck.slides[state.pitchDeck.currentSlide];
    if (currentSlide) {
        const textToCopy = `### ${currentSlide.title}\n\n${currentSlide.content}`;
        navigator.clipboard.writeText(textToCopy);
        const btn = document.getElementById('copy-slide-btn');
        if (btn) {
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4"><path d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0Z" /></svg> Copied!`;
            setTimeout(() => {
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4"><path d="M5.5 2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-5ZM5 2a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 10 .5v1a.5.5 0 0 0 1 0v-1A2.5 2.5 0 0 0 8.5 0h-2A2.5 2.5 0 0 0 4 2.5v1a.5.5 0 0 0 1 0v-1.5Z"/></svg> Copy Slide`;
            }, 2000);
        }
    }
}

// --- 7. AUTOCOMPLETE ---
function autocomplete(inp: HTMLInputElement, arr: {ticker: string, name: string}[]) {
    let currentFocus;
    if (!inp) return;
    
    const closeAllLists = (elmnt: EventTarget | null) => {
        const x = document.getElementsByClassName("autocomplete-items");
        for (let i = 0; i < x.length; i++) {
            if (elmnt != x[i] && elmnt != inp) {
                x[i].parentNode.removeChild(x[i]);
            }
        }
    }

    inp.addEventListener("input", function(this: HTMLInputElement, e: Event) {
        let a, b, i, val = this.value;
        // --- FIX: Pass null to closeAllLists as it expects one argument. ---
        closeAllLists(null);
        if (!val) { return false;}
        currentFocus = -1;
        a = document.createElement("DIV");
        a.setAttribute("id", this.id + "autocomplete-list");
        a.setAttribute("class", "autocomplete-items");
        this.parentNode.appendChild(a);
        
        const filteredArr = arr.filter(item => 
            item.ticker.toUpperCase().includes(val.toUpperCase()) || 
            item.name.toUpperCase().includes(val.toUpperCase())
        ).slice(0, 5);

        for (i = 0; i < filteredArr.length; i++) {
            b = document.createElement("DIV");
            b.setAttribute("class", "autocomplete-item");
            
            const highlight = (text, query) => text.replace(new RegExp(query, 'gi'), (match) => `<strong>${match}</strong>`);
            
            b.innerHTML = `
                <span class="name">${highlight(filteredArr[i].name, val)}</span>
                <span class="ticker">${highlight(filteredArr[i].ticker, val)}</span>`;
            
            b.dataset.ticker = filteredArr[i].ticker;

            b.addEventListener("click", function(this: HTMLDivElement, e: MouseEvent) {
                inp.value = this.dataset.ticker;
                if(inp.id === 'welcome-ticker-input') {
                   setState({ welcomeTicker: inp.value });
                }
                closeAllLists(null);
            });
            a.appendChild(b);
        }
    });

    document.addEventListener("click", function (e) {
        closeAllLists(e.target);
    });
}

// --- 8. INITIALIZATION & DATA ---
async function initData(ticker) {
    setState({ loading: { ...state.loading, data: true }, error: null, ticker: ticker.toUpperCase(), tickerSwitchError: '' });
    
    stopRealtimeUpdates(); // Stop previous updates
    
    try {
        const summaryData = await apiService.getTickerSummary(ticker);

        // Fetch peer data
        const peerTickers = peerMap[ticker.toUpperCase()] || [];
        const peerPromises = [ticker, ...peerTickers].map(t => 
            apiService.getTickerSummary(t).catch(e => {
                console.warn(`Could not fetch data for peer ${t}:`, e.message);
                return null; // Return null if a peer fails
            })
        );
        const peerData = (await Promise.all(peerPromises)).filter(p => p !== null);

        // Simulate fetching workflow data for now
        const workflow = generateWorkflowData(summaryData);
        
        setState({
            dashboardData: { quote: summaryData, peers: peerData, workflow },
            loading: { ...state.loading, data: false },
            error: null,
            // Reset related states on new ticker load
            lboScenario: 'baseCase',
            currentTab: 'valuation_models',
            pitchDeck: { ticker: null, currentSlide: 0, slides: [] },
            alert: { target: null, active: false, triggered: false, direction: null },
            showAlertInput: false,
        });

        startRealtimeUpdates();

    } catch (e) {
        console.error("Failed to initialize data:", e);
        setState({ loading: { ...state.loading, data: false }, error: e.message });
        throw e; // Re-throw to be caught by handlers
    }
}

function updateQuoteData(newQuoteData) {
    const oldPrice = state.dashboardData?.quote?.price;
    const newPrice = newQuoteData?.price;
    
    setState({
        dashboardData: { ...state.dashboardData, quote: newQuoteData }
    });
    
    if (oldPrice && newPrice) {
        const priceElement = document.getElementById('header-latest-price');
        if (priceElement) {
            priceElement.classList.remove('flash-text-green', 'flash-text-red');
            if (newPrice > oldPrice) {
                priceElement.classList.add('flash-text-green');
            } else if (newPrice < oldPrice) {
                priceElement.classList.add('flash-text-red');
            }
        }
    }
    checkPriceAlert();
}

function startRealtimeUpdates() {
    stopRealtimeUpdates(); // Ensure no multiple intervals are running
    setState({ realtimeStatus: 'connecting' });
    
    const fetchUpdate = async () => {
        try {
            const summaryData = await apiService.getTickerSummary(state.ticker);
            updateQuoteData(summaryData);
            if(state.realtimeStatus !== 'connected') setState({ realtimeStatus: 'connected' });
        } catch (error) {
            console.error('Real-time update failed:', error);
            setState({ realtimeStatus: 'error' });
        }
    };

    fetchUpdate(); // Initial fetch
    realtimeIntervalId = setInterval(fetchUpdate, 30000); // Update every 30 seconds
}

function stopRealtimeUpdates() {
    if (realtimeIntervalId) {
        clearInterval(realtimeIntervalId);
        realtimeIntervalId = null;
    }
}

function checkPriceAlert() {
    const { alert, dashboardData } = state;
    if (alert.active && !alert.triggered && dashboardData?.quote?.price) {
        const currentPrice = dashboardData.quote.price;
        if ((alert.direction === 'up' && currentPrice >= alert.target) ||
            (alert.direction === 'down' && currentPrice <= alert.target)) {
            setState({ alert: { ...alert, triggered: true } });
        }
    }
}


// --- DUMMY DATA GENERATION (to be replaced by real logic) ---
function generateWorkflowData(quote) {
    const domain = getTickerDomain(quote.ticker);
    const isFinancial = domain === 'Financials';
    
    const dcfInputs = isFinancial ? {
        roe: { value: quote.roe || 0.15, min: 0.05, max: 0.30, step: 0.005 },
        reinvestmentRate: { value: 0.40, min: 0.20, max: 0.80, step: 0.01 },
        costOfEquity: { value: 0.09, min: 0.05, max: 0.15, step: 0.001 },
        terminalGrowth: { value: 0.025, min: 0.01, max: 0.05, step: 0.001 },
    } : {
        revenueGrowth: { value: quote.revenueGrowth || 0.05, min: -0.05, max: 0.20, step: 0.005 },
        operatingMargin: { value: 0.20, min: 0.05, max: 0.40, step: 0.005 },
        taxRate: { value: quote.taxRate, min: 0.10, max: 0.40, step: 0.005 },
        reinvestmentRate: { value: 0.30, min: 0.10, max: 0.60, step: 0.01 },
        wacc: { value: 0.08, min: 0.05, max: 0.12, step: 0.001 },
        terminalGrowth: { value: 0.025, min: 0.01, max: 0.05, step: 0.001 },
    };
    
    // Simplified DCF calculation
    const terminalValue = (quote.ebitda * (1 + dcfInputs.terminalGrowth.value)) / ((dcfInputs.wacc?.value || dcfInputs.costOfEquity.value) - dcfInputs.terminalGrowth.value);
    const enterpriseValue = terminalValue; // Highly simplified
    const equityValue = enterpriseValue - quote.netDebt;
    const impliedSharePrice = equityValue / quote.shares;
    
    const generateLboScenario = (id) => ({
        header: { ticker: quote.ticker, scenario: `${id} Scenario`, scenarioId: id },
        inputs: {
            purchasePrice: { value: quote.marketCap },
            debtFinancing: { value: 0.6, min: 0.4, max: 0.8, step: 0.01 },
            interestRate: { value: quote.interestRate, min: 0.05, max: 0.12, step: 0.0025 },
            ebitdaGrowth: { value: 0.05, min: 0, max: 0.15, step: 0.005 },
            exitMultiple: { value: quote.evEbitda || 12, min: 8, max: 20, step: 0.25 },
            holdingPeriod: { value: 5, min: 3, max: 7, step: 1 },
            // Scenario specific inputs
            recapYear: { value: 3, min: 2, max: 5, step: 1 },
            dividendPayout: { value: 0.5, min: 0.2, max: 0.8, step: 0.05 },
            mezzanineFinancing: { value: 0.15, min: 0.05, max: 0.3, step: 0.01 },
            mezzanineInterestRate: { value: 0.14, min: 0.10, max: 0.20, step: 0.005 },
        },
        outputs: {
            projections: Array.from({ length: 5 }, (_, i) => ({
                year: i + 1,
                ebitda: quote.ebitda * Math.pow(1.05, i + 1),
                cashFlow: quote.ebitda * Math.pow(1.05, i + 1) * 0.6,
                endingDebt: quote.marketCap * 0.6 * (1 - (i + 1) * 0.15)
            })),
            returns: {
                irr: Math.random() * 0.15 + 0.15, // 15-30%
                moic: Math.random() * 1.5 + 2.0, // 2.0-3.5x
                entryEquity: quote.marketCap * (1 - 0.6),
                exitEquity: (quote.ebitda * Math.pow(1.05, 5) * 12) - (quote.marketCap * 0.6 * (1 - 5 * 0.15))
            }
        }
    });

    const lboScenarios = DOMAIN_SCENARIOS[domain].map(s => generateLboScenario(s.id));

    return {
        dcfValuation: {
            header: { ticker: quote.ticker, badge: isFinancial ? 'DDM Model' : 'DCF Model' },
            modelType: isFinancial ? 'DDM' : 'DCF',
            inputs: dcfInputs,
            outputs: {
                impliedSharePrice,
                premium: (impliedSharePrice / quote.price) - 1,
                enterpriseValue,
                equityValue,
            },
        },
        lboAnalysis: {
            scenarios: lboScenarios
        }
    };
}


// --- 9. APP INITIALIZATION ---
function initApp() {
    loadState();
    document.body.classList.toggle('dark-mode', state.theme === 'dark');
    renderApp();
}

document.addEventListener('DOMContentLoaded', initApp);