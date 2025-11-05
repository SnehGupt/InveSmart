
import React from 'react';
import { AnalysisResult, Source } from '../types';
import SourcePill from './SourcePill';
import { DocumentIcon } from './icons';

interface AnalysisDisplayProps {
  analysis: AnalysisResult;
  sources: Source[];
  onGeneratePitchDeck: () => void;
  isPitchDeckLoading: boolean;
}

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({ analysis, sources, onGeneratePitchDeck, isPitchDeckLoading }) => {
  return (
    <div className="mt-8 bg-slate-800/50 rounded-xl shadow-lg border border-slate-700 p-6 md:p-8 animate-fade-in">
      <header className="mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-white">{analysis.companyName} ({analysis.tickerSymbol})</h2>
        <p className="text-teal-400 mt-1">{analysis.finalRecommendation}</p>
      </header>

      <div className="space-y-6">
        {/* Summary Card */}
        <div className="bg-slate-900 p-5 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-slate-300 mb-2">Valuation Summary</h3>
          <p className="text-slate-400 whitespace-pre-wrap">{analysis.valuationSummary}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Key Financials */}
          <div className="bg-slate-900 p-5 rounded-lg border border-slate-700">
            <h3 className="text-lg font-semibold text-slate-300 mb-3">Key Financials (LTM)</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-slate-400">Revenue:</span> <span className="font-mono text-white">{analysis.keyFinancials.revenueLTM}</span></li>
              <li className="flex justify-between"><span className="text-slate-400">Net Income:</span> <span className="font-mono text-white">{analysis.keyFinancials.netIncomeLTM}</span></li>
              <li className="flex justify-between"><span className="text-slate-400">Operating Cash Flow:</span> <span className="font-mono text-white">{analysis.keyFinancials.cashFlowLTM}</span></li>
              <li className="pt-2 mt-2 border-t border-slate-700"><span className="text-slate-400">Ratios:</span> <p className="text-white mt-1">{analysis.keyFinancials.keyRatios}</p></li>
            </ul>
          </div>

          {/* Reasoning */}
          <div className="bg-slate-900 p-5 rounded-lg border border-slate-700">
            <h3 className="text-lg font-semibold text-slate-300 mb-2">Price Adjustment Reasoning</h3>
            <p className="text-slate-400 whitespace-pre-wrap text-sm">{analysis.priceAdjustmentReasoning}</p>
          </div>
        </div>

        {/* Recent News Analysis */}
        <div className="bg-slate-900 p-5 rounded-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-slate-300 mb-3">Recent News Analysis</h3>
          <div className="space-y-4">
            {analysis.recentNewsAnalysis.map((news, index) => (
              <div key={index} className="border-l-2 border-teal-400 pl-4">
                <h4 className="font-semibold text-white">{news.headline}</h4>
                <p className="text-slate-400 text-sm mt-1">{news.impact}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sources */}
        {sources.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-400 mb-3">Sources</h3>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, index) => (
                <SourcePill key={source.uri} source={source} index={index} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pitch Deck Button */}
      <div className="mt-8 pt-6 border-t border-slate-700 flex justify-center">
        <button
          onClick={onGeneratePitchDeck}
          disabled={isPitchDeckLoading}
          className="inline-flex items-center gap-2 px-6 py-3 bg-teal-500 text-white font-semibold rounded-lg shadow-md hover:bg-teal-600 disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105"
        >
          {isPitchDeckLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </>
          ) : (
            <>
              <DocumentIcon className="w-5 h-5" />
              Generate Pitch Deck
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default AnalysisDisplay;
