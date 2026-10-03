import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Allocation() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'LOADING' | 'ALLOCATED' | 'WAITLISTED'>('LOADING');

  useEffect(() => {
    // Simulate fetching allocation result
    const timer = setTimeout(() => {
      setStatus('ALLOCATED');
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (status === 'LOADING') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold">Revealing Allocation...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8 mt-12 bg-white shadow rounded-lg border-t-8 border-green-500">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl">
          ✓
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">You're In!</h1>
        <p className="text-gray-500 mt-2 text-lg">You have been randomly selected for FUTUREFEST 2026.</p>
      </div>

      <div className="bg-gray-50 p-6 rounded-lg mb-8 border border-gray-200">
        <h3 className="font-bold text-gray-800 mb-4">Next Steps</h3>
        <ul className="text-gray-600 space-y-3">
          <li className="flex items-start">
            <span className="mr-2">⏱️</span>
            <span>Your ticket is currently held for <strong>5:00 minutes</strong>.</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">💳</span>
            <span>Proceed to complete your reservation to confirm your spot.</span>
          </li>
        </ul>
      </div>

      <button 
        onClick={() => navigate('/reservation')}
        className="w-full bg-black text-white font-bold py-4 rounded hover:bg-gray-800 transition"
      >
        Proceed to Reservation
      </button>
    </div>
  );
}
