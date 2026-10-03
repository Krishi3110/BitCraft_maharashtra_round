import React from 'react';

export default function Ticket() {
  return (
    <div className="max-w-md mx-auto p-8 mt-12 bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-2 bg-blue-500"></div>
      
      <div className="text-center mb-8 pt-4">
        <h1 className="text-2xl font-black tracking-tight">FUTUREFEST 2026</h1>
        <p className="text-sm text-gray-500 mt-1">October 15, 2026 • Neo-Tokyo</p>
      </div>

      <div className="flex justify-center mb-8">
        <div className="w-48 h-48 bg-gray-100 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
          <p className="text-gray-400 font-mono text-xs text-center px-4">
            [QR_CODE_MOCK]<br/><br/>
            tkt_8f92bd3a
          </p>
        </div>
      </div>

      <div className="space-y-4 border-t pt-6 border-dashed">
        <div className="flex justify-between">
          <span className="text-gray-500 text-sm">Participant ID</span>
          <span className="font-mono text-sm font-bold">p_123456789</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-sm">Ticket Type</span>
          <span className="font-bold text-sm">General Admission</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-sm">Status</span>
          <span className="text-green-600 font-bold text-sm bg-green-50 px-2 rounded">CONFIRMED</span>
        </div>
      </div>

      <div className="mt-8 text-center">
        <p className="text-xs text-gray-400">Please save this ticket or take a screenshot.</p>
      </div>
    </div>
  );
}
