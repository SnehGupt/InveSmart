
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, PitchDeckSlide, Source } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const parseJsonFromMarkdown = (markdown: string): any => {
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = markdown.match(jsonBlockRegex);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.error("Failed to parse JSON from markdown", e);
            throw new Error("Invalid JSON format in the model's response.");
        }
    }
    throw new Error("Could not find a JSON block in the model's response.");
};

export const getCompanyValuation = async (companyName: string, question: string): Promise<{ analysis: AnalysisResult; sources: Source[] }> => {
    const model = 'gemini-2.5-pro';

    const valuationPrompt = `
      Act as a first-year junior investment banking analyst from a top-tier bank. Your task is to perform a valuation analysis for "${companyName}".
      Your analysis must be based on the latest available public financial data (like cash flows and earnings from the last 12-24 months) and recent significant news.
      The user's specific question is: "${question}"

      Structure your entire response as a single JSON object inside a markdown code block. Do not include any text outside of the code block.
      The JSON object MUST strictly adhere to this schema:
      {
        "companyName": "The official company name",
        "tickerSymbol": "The company's stock ticker symbol",
        "valuationSummary": "A concise, executive summary of your valuation findings and price adjustment recommendation.",
        "keyFinancials": {
          "revenueLTM": "Last Twelve Months Revenue with currency, e.g., '$250B'.",
          "netIncomeLTM": "Last Twelve Months Net Income with currency.",
          "cashFlowLTM": "Last Twelve Months Operating Cash Flow with currency.",
          "keyRatios": "Brief analysis of key ratios like P/E, P/S, or EV/EBITDA."
        },
        "recentNewsAnalysis": [
          { "headline": "Headline of a recent significant news event.", "impact": "Analysis of the news's impact on the company's valuation." }
        ],
        "priceAdjustmentReasoning": "Detailed reasoning for your adjustment recommendation, integrating the financial data and news analysis.",
        "finalRecommendation": "A clear final recommendation: e.g., 'Adjust price upwards by 5-10%', 'Maintain current price with a neutral outlook', etc."
      }
    `;

    const response = await ai.models.generateContent({
        model: model,
        contents: valuationPrompt,
        config: {
            tools: [{ googleSearch: {} }],
        },
    });
    
    const analysis = parseJsonFromMarkdown(response.text) as AnalysisResult;
    
    const rawSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: Source[] = rawSources
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title,
      }));
    
    return { analysis, sources };
};

export const generatePitchDeck = async (analysis: AnalysisResult): Promise<PitchDeckSlide[]> => {
    const model = 'gemini-2.5-pro';

    const pitchDeckPrompt = `
      Act as a junior investment banking analyst. Based on the following JSON valuation analysis, create a concise 5-slide pitch deck.
      The pitch deck should be for an internal meeting to discuss a potential trade or advisory role.
      The slides should cover: 1. Executive Summary, 2. Financial Performance, 3. Recent Developments & News, 4. Valuation Rationale, 5. Recommendation & Next Steps.

      Analysis Data:
      ${JSON.stringify(analysis, null, 2)}
    `;

    const response = await ai.models.generateContent({
        model: model,
        contents: pitchDeckPrompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        slideNumber: { type: Type.INTEGER },
                        title: { type: Type.STRING },
                        bulletPoints: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        },
                    },
                    required: ["slideNumber", "title", "bulletPoints"]
                }
            }
        }
    });

    return JSON.parse(response.text) as PitchDeckSlide[];
};
