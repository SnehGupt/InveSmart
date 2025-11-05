
import React, { useState, useCallback } from 'react';
import { AnalysisResult, PitchDeckSlide, Source } from './types';
import { getCompanyValuation, generatePitchDeck } from './services/geminiService';
import Header from './components/Header';
import LoadingSpinner from './components/LoadingSpinner';
import AnalysisDisplay from './components/AnalysisDisplay';
import PitchDeckView from './components/PitchDeckView';
import { SparklesIcon } from './components/icons';

const App: React.FC = () => {
  const [companyName, setCompanyName] = useState<string>('Banksmart');
  const [question, setQuestion] = useState<string>('Taking all factors and latest news into account, how would you adjust the stock price?');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [pitchDeck, setPitchDeck] = useState<PitchDeckSlide[] | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState<boolean>(false);
  const [isLoadingPitchDeck, setIsLoadingPitchDeck] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!companyName.trim() || !question.trim()) {
      setError("Please provide both a company name and a question.");
      return;
    }
    setIsLoadingAnalysis(true);
    setError(null);
    setAnalysis(null);
    setPitchDeck(null);

    try {
      const result = await getCompanyValuation(companyName, question);
      setAnalysis(result.analysis);
      setSources(result.sources);
    } catch (e: any) {
      console.error(e);
      setError(`Failed to get analysis. ${e.message}`);
    } finally {
      setIsLoadingAnalysis(false);
    }
  }, [companyName, question]);

  const handleGeneratePitchDeck = useCallback(async () => {
    if (!analysis) return;
    setIsLoadingPitchDeck(true);
    setError(null);
    try {
      const slides = await generatePitchDeck(analysis);
      setPitchDeck(slides);
    } catch (e: any) {
      console.error(e);
      setError(`Failed to generate pitch deck. ${e.message}`);
    } finally {
      setIsLoadingPitchDeck(false);
    }
  }, [analysis]);

  return (
    <div className="min-h-screen bg-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Header />

        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-2xl">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-slate-300 mb-1">Company Name or Ticker</label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g., Apple or AAPL"
                className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div>
              <label htmlFor="question" className="block text-sm font-medium text-slate-300 mb-1">Your Core Question</label>
              <input
                id="question"
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g., Adjust stock price based on news?"
                className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          </div>
          <div className="mt-4 text-center">
            <button
              onClick={handleAnalyze}
              disabled={isLoadingAnalysis}
              className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 bg-teal-500 text-white font-semibold rounded-lg shadow-md hover:bg-teal-600 disabled:bg-slate-600 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105"
            >
              <SparklesIcon className="w-5 h-5" />
              {isLoadingAnalysis ? 'Analyzing...' : 'Run Analysis'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-center">
            <p>{error}</p>
          </div>
        )}

        {isLoadingAnalysis && <LoadingSpinner text="Performing valuation analysis... This may take a moment." />}

        {analysis && (
          <AnalysisDisplay 
            analysis={analysis} 
            sources={sources}
            onGeneratePitchDeck={handleGeneratePitchDeck}
            isPitchDeckLoading={isLoadingPitchDeck}
          />
        )}
        
        {pitchDeck && <PitchDeckView slides={pitchDeck} />}
      </div>
    </div>
  );
};

export default App;
