import { useState } from 'react';

export default function StressTest() {
  const [running, setRunning] = useState(false);

  return (
    <div className="max-w-5xl mx-auto p-6 bg-white shadow rounded mt-6">
      <h1 className="text-3xl font-bold mb-6 border-b pb-4">Stress Test Configuration</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Participants</label>
            <input type="number" defaultValue={50000} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Human Percentage (%)</label>
            <input type="range" min="0" max="100" defaultValue={70} className="mt-1 block w-full" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Bot Percentage (%)</label>
            <input type="range" min="0" max="100" defaultValue={30} className="mt-1 block w-full" />
          </div>
        </div>
        
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Attack Profile</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border">
              <option>Normal</option>
              <option>Flash Crowd</option>
              <option>Flood</option>
              <option>Retry Storm</option>
              <option>Multi-session</option>
              <option>Slow Bot</option>
              <option>Human-like Bot</option>
              <option>Mixed Attack</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Request Amplification</label>
              <input type="number" defaultValue={1} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Concurrency</label>
              <input type="number" defaultValue={100} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex space-x-4 border-t pt-6">
        <button 
          onClick={() => setRunning(true)}
          disabled={running}
          className="bg-green-600 text-white px-6 py-2 rounded font-bold disabled:opacity-50"
        >
          START EXPERIMENT
        </button>
        <button 
          onClick={() => setRunning(false)}
          disabled={!running}
          className="bg-red-600 text-white px-6 py-2 rounded font-bold disabled:opacity-50"
        >
          STOP
        </button>
        <button className="bg-gray-200 text-gray-800 px-6 py-2 rounded font-bold">
          RESET
        </button>
      </div>

      {running && (
        <div className="mt-8 p-4 bg-gray-50 border rounded text-sm font-mono text-gray-600">
          <p>[0.00s] Initializing population generator...</p>
          <p>[0.05s] 50000 logical participants generated (Seed: 12345)</p>
          <p>[0.10s] Starting HTTP transport abstraction...</p>
          <p className="animate-pulse">[0.15s] Sending requests...</p>
        </div>
      )}
    </div>
  );
}
