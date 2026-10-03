import { useState, useEffect } from 'react';

export default function Audit() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s < 5 ? s + 1 : s));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const steps = [
    { title: "1. Registration Closed", desc: "No more entries accepted." },
    { title: "2. Snapshot Finalized", desc: "Hash: 0xabc1239847... (Immutable)" },
    { title: "3. Server Seed Revealed", desc: "Seed: random-server-seed-987 (Provably Fair)" },
    { title: "4. Deterministic Shuffle", desc: "HMAC(Seed + Snapshot) applied to all participants." },
    { title: "5. Winners Allocated", desc: "Top 500 ranked users receive tickets." },
    { title: "6. Waitlist Formed", desc: "Remaining users appended to the waitlist queue." }
  ];

  return (
    <div className="max-w-4xl mx-auto p-8 mt-12 bg-white shadow rounded-lg">
      <h1 className="text-3xl font-bold mb-2">Fairness Audit & Visualization</h1>
      <p className="text-gray-600 mb-8">This dashboard visually explains the deterministic allocation algorithm.</p>
      
      <div className="relative">
        <div className="absolute left-8 top-0 bottom-0 w-1 bg-gray-200 rounded"></div>
        
        <div className="space-y-8">
          {steps.map((s, idx) => {
            const isActive = idx === step;
            const isCompleted = idx < step;
            const isPending = idx > step;
            
            return (
              <div key={idx} className={`relative flex items-start pl-16 transition-opacity duration-500 ${isPending ? 'opacity-30' : 'opacity-100'}`}>
                <div className={`absolute left-6 w-5 h-5 rounded-full border-4 bg-white
                  ${isCompleted ? 'border-green-500' : isActive ? 'border-blue-500 animate-pulse' : 'border-gray-300'}
                `} style={{ top: '6px' }}></div>
                
                <div>
                  <h3 className={`font-bold text-lg ${isActive ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'}`}>
                    {s.title}
                  </h3>
                  <p className="text-gray-600 font-mono text-sm mt-1 bg-gray-50 p-2 rounded inline-block border">
                    {s.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {step === 5 && (
        <div className="mt-12 p-6 bg-green-50 text-green-800 rounded border border-green-200">
          <h3 className="font-bold mb-2">✓ Allocation Complete and Independently Verifiable</h3>
          <p className="text-sm">Anyone can download the Snapshot and the Server Seed to run the open-source HMAC algorithm locally and prove that the resulting queue order matches the server's exact results.</p>
        </div>
      )}
    </div>
  );
}
