import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Reservation() {
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (timeLeft <= 0) {
      navigate('/'); // Expired
      return;
    }
    const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, navigate]);

  const handleConfirm = () => {
    setIsConfirming(true);
    setTimeout(() => {
      navigate('/ticket');
    }, 2000);
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="max-w-3xl mx-auto p-8 mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-2 bg-white shadow rounded-lg p-8">
        <div className="flex justify-between items-center border-b pb-4 mb-6">
          <h1 className="text-3xl font-bold">Complete Reservation</h1>
          <div className="text-red-500 font-mono font-bold text-xl bg-red-50 px-3 py-1 rounded">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">Participant Information</h3>
            <div className="bg-gray-50 p-4 rounded border">
              <p className="text-sm text-gray-600">ID: p_123456789</p>
              <p className="text-sm text-gray-600">Status: Identity Verified</p>
            </div>
          </div>
          
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">Order Summary</h3>
            <div className="bg-gray-50 p-4 rounded border flex justify-between items-center">
              <div>
                <p className="font-bold">FUTUREFEST 2026</p>
                <p className="text-sm text-gray-500">General Admission x 1</p>
              </div>
              <p className="font-bold">$0.00</p>
            </div>
          </div>
        </div>

        <button 
          onClick={handleConfirm}
          disabled={isConfirming}
          className="w-full mt-8 bg-blue-600 text-white font-bold py-4 rounded hover:bg-blue-700 transition disabled:opacity-50"
        >
          {isConfirming ? 'Confirming...' : 'Confirm Reservation'}
        </button>
      </div>

      <div className="bg-gray-50 shadow rounded-lg p-6 h-fit border border-gray-200">
        <h3 className="font-bold mb-4">Why is there a timer?</h3>
        <p className="text-sm text-gray-600 mb-4">
          To ensure fairness, tickets are held for a limited time. If you do not complete your reservation before the timer expires, your ticket will be offered to the next person on the waitlist.
        </p>
      </div>
    </div>
  );
}
