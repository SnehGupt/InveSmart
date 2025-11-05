import React from 'react';
import { SparklesIcon } from './icons';

const Header: React.FC = () => {
  return (
    <header className="text-center mb-8">
      <div className="flex items-center justify-center gap-3">
        <SparklesIcon className="w-8 h-8 text-teal-400" />
        <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">BankSmart</h1>
      </div>
      <p className="mt-3 text-slate-400 max-w-2xl mx-auto">
        Automating junior investment banker workflows with Gemini 2.5 Pro. Analyze companies, value stocks, and generate pitch decks instantly.
      </p>
    </header>
  );
};

export default Header;