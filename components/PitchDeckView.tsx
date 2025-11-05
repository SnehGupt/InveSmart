
import React from 'react';
import { PitchDeckSlide } from '../types';

interface PitchDeckViewProps {
  slides: PitchDeckSlide[];
}

const PitchDeckView: React.FC<PitchDeckViewProps> = ({ slides }) => {
  return (
    <div className="mt-8 animate-fade-in">
      <h2 className="text-2xl font-bold text-center text-white mb-6">Generated Pitch Deck</h2>
      <div className="flex gap-6 overflow-x-auto pb-6 custom-scrollbar">
        {slides.map((slide) => (
          <div
            key={slide.slideNumber}
            className="flex-shrink-0 w-80 h-96 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-5 flex flex-col relative"
          >
            <div className="absolute top-2 right-3 text-5xl font-bold text-slate-700/50">{slide.slideNumber}</div>
            <div className="relative z-10">
              <h3 className="text-teal-400 font-bold text-lg mb-4 truncate">{slide.title}</h3>
              <ul className="space-y-2 list-disc list-inside text-slate-300 text-sm">
                {slide.bulletPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PitchDeckView;
