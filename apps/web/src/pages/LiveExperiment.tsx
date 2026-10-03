import React, { useState, useEffect } from 'react';

export default function LiveExperiment() {
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    // Mock WebSocket incoming events
    const mockStream = [
      "Rate limit triggered: 403 (IP 192.168.1.44)",
      "Allocation started",
      "User p_123456789 allocated ticket",
      "Challenge issued: CAPTCHA required",
      "Duplicate collapsed: account_id acc_987",
      "Reservation expired for p_9999999"
    ];

    let count = 0;
    const timer = setInterval(() => {
      if (count < mockStream.length) {
        setEvents(prev => [mockStream[count], ...prev]);
        count++;
      } else {
        clearInterval(timer);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-8 mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-2">
        <h1 className="text-3xl font-bold mb-4">Live Experiment Stream</h1>
        <div className="bg-black text-green-400 p-6 rounded-lg font-mono text-sm h-[500px] overflow-y-auto shadow-inner border border-gray-800">
          {events.length === 0 && <p className="opacity-50">Waiting for stream...</p>}
          {events.map((ev, i) => (
            <div key={i} className="mb-2">
              <span className="text-gray-500">[{new Date().toLocaleTimeString()}]</span> {ev}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white p-6 rounded shadow border">
          <h3 className="font-bold text-gray-700 mb-4">Active Metrics</h3>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">Requests / Sec</p>
              <p className="text-2xl font-mono">1,452</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Blocked (WAF)</p>
              <p className="text-2xl font-mono text-red-500">843</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">P50 Latency</p>
              <p className="text-2xl font-mono">42ms</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">P99 Latency</p>
              <p className="text-2xl font-mono text-yellow-500">189ms</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
