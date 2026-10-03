import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export default function Event() {
  const navigate = useNavigate();
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.getDropState('ev_123')
      .then(res => {
        setState(res);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-8 text-center">Loading event details...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="max-w-4xl mx-auto p-8 bg-white shadow rounded-lg mt-8">
      <div className="mb-6 border-b pb-4">
        <span className="bg-blue-100 text-blue-800 text-xs font-semibold mr-2 px-2.5 py-0.5 rounded">High Demand Event</span>
        <h1 className="text-4xl font-extrabold mt-2 tracking-tight">FUTUREFEST 2026</h1>
        <p className="text-gray-500 mt-2">The tech event of the decade. Live from Neo-Tokyo.</p>
        <p className="text-sm font-mono mt-2 bg-gray-100 p-2 rounded inline-block">Status: {state?.state || 'UNKNOWN'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          <h3 className="text-lg font-semibold mb-2">Event Information</h3>
          <ul className="text-gray-600 space-y-2">
            <li>📅 Date: October 15, 2026</li>
            <li>📍 Location: Neo-Tokyo Convention Center</li>
            <li>🎫 Tickets Available: {state?.config?.total_inventory || 500}</li>
          </ul>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold mb-2">Registration Window</h3>
          <p className="text-gray-600 mb-2">Opens in: <span className="font-mono font-bold text-black">00:00:00</span></p>
          <p className="text-sm text-gray-500">Registration is currently open. Ensure your payment methods are updated.</p>
        </div>
      </div>

      <div className="text-center mt-12">
        <Link 
          to="/drop" 
          className="bg-black text-white px-8 py-4 rounded-md font-bold hover:bg-gray-800 transition shadow-lg w-full md:w-auto inline-block"
        >
          Join Fair Drop
        </Link>
        <p className="text-xs text-gray-400 mt-4">Powered by Fair Drop Engine</p>
      </div>
    </div>
  );
}
