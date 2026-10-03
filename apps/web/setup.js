import fs from 'fs';


const pages = ['Home', 'Event', 'Drop', 'Queue', 'Allocation', 'Reservation', 'Ticket', 'StressTest', 'LiveExperiment', 'Results', 'Audit'];

fs.mkdirSync('src/pages', { recursive: true });
fs.mkdirSync('src/api', { recursive: true });
fs.mkdirSync('src/telemetry', { recursive: true });
fs.mkdirSync('src/components', { recursive: true });

pages.forEach(page => {
  fs.writeFileSync(`src/pages/${page}.tsx`, `import React from 'react';\n\nexport default function ${page}() {\n  return (\n    <div className="min-h-screen p-8">\n      <h1 className="text-3xl font-bold mb-4">${page}</h1>\n      <p>Placeholder for ${page} UI.</p>\n    </div>\n  );\n}\n`);
});

const clientTs = `import { getMockApi } from './mock';\n\nconst USE_MOCK = true;\n\nexport const apiClient = USE_MOCK ? getMockApi() : {};\n`;
fs.writeFileSync(`src/api/client.ts`, clientTs);

const mockTs = `export function getMockApi() {\n  return {\n    getEventDetails: async () => ({ id: 'ev_123', name: 'FUTUREFEST 2026', totalTickets: 500 }),\n    joinDrop: async () => ({ status: 'waiting', participantId: 'p_999' }),\n    getAllocationStatus: async () => ({ status: 'allocated' }),\n  };\n}\n`;
fs.writeFileSync(`src/api/mock.ts`, mockTs);

const telemetryTs = `export class TelemetryCollector {\n  private buffer: any[] = [];\n  private windowMs: number;\n  private interval: any;\n\n  constructor(windowMs = 5000) {\n    this.windowMs = windowMs;\n  }\n\n  start() {\n    this.interval = setInterval(() => this.flush(), this.windowMs);\n  }\n\n  stop() {\n    if (this.interval) clearInterval(this.interval);\n  }\n\n  recordEvent(type: string, data: any = {}) {\n    this.buffer.push({ type, timestamp: Date.now(), ...data });\n  }\n\n  private flush() {\n    if (this.buffer.length === 0) return;\n    console.log('[Telemetry Flush]', this.buffer);\n    this.buffer = [];\n  }\n}\n\nexport const telemetry = new TelemetryCollector();\n`;
fs.writeFileSync(`src/telemetry/collector.ts`, telemetryTs);

const appTsx = `import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { telemetry } from './telemetry/collector';
${pages.map(page => `import ${page} from './pages/${page}';`).join('\n')}

export default function App() {
  useEffect(() => {
    telemetry.start();
    const clickHandler = () => telemetry.recordEvent('click');
    const scrollHandler = () => telemetry.recordEvent('scroll');
    const keyHandler = () => telemetry.recordEvent('keypress');
    
    window.addEventListener('click', clickHandler);
    window.addEventListener('scroll', scrollHandler);
    window.addEventListener('keydown', keyHandler);
    
    return () => {
      telemetry.stop();
      window.removeEventListener('click', clickHandler);
      window.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('keydown', keyHandler);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="bg-gray-100 min-h-screen">
        <nav className="bg-white p-4 shadow mb-4">
          <ul className="flex space-x-4 flex-wrap">
            ${pages.map(page => `<li><Link to="${page === 'Home' ? '/' : '/' + page.toLowerCase().replace('test', '-test').replace('experiment', '-experiment')}" className="text-blue-600 hover:underline">${page}</Link></li>`).join('\n            ')}
          </ul>
        </nav>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/event" element={<Event />} />
          <Route path="/drop" element={<Drop />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/allocation" element={<Allocation />} />
          <Route path="/reservation" element={<Reservation />} />
          <Route path="/ticket" element={<Ticket />} />
          <Route path="/stress-test" element={<StressTest />} />
          <Route path="/live-experiment" element={<LiveExperiment />} />
          <Route path="/results" element={<Results />} />
          <Route path="/audit" element={<Audit />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
`;
fs.writeFileSync(`src/App.tsx`, appTsx);
