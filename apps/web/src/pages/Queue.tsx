import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export default function Queue() {
  const [status, setStatus] = useState('Waiting in line...');
  const navigate = useNavigate();

  useEffect(() => {
    // Simulate some waiting
    const timer = setTimeout(async () => {
      setStatus('Assigning allocation...');
      try {
        const res = await apiClient.getAllocationStatus('ev_123', 'p_123456789');
        setTimeout(() => {
          if (res.status === 'ALLOCATED') {
            navigate('/allocation');
          } else {
            navigate('/results');
          }
        }, 2000);
      } catch (err) {
        setStatus('Error retrieving status.');
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="max-w-xl mx-auto p-8 mt-12 text-center bg-white shadow rounded-lg border-t-4 border-blue-500">
      <h2 className="text-2xl font-bold mb-4">Waiting Room</h2>
      <div className="my-8 animate-pulse">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
      </div>
      <p className="text-xl font-medium mb-2">{status}</p>
      <p className="text-gray-500 text-sm mt-4">Participant ID: p_123456789</p>
      <div className="bg-yellow-50 text-yellow-800 p-4 rounded-md mt-6 text-sm text-left">
        <strong>Note:</strong> Refreshing does not improve your chances. You will be automatically redirected when it is your turn.
      </div>
    </div>
  );
}
