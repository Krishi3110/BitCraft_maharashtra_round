import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { telemetry } from './telemetry/collector';
import Home from './pages/Home';
import Event from './pages/Event';
import Drop from './pages/Drop';
import Queue from './pages/Queue';
import Allocation from './pages/Allocation';
import Reservation from './pages/Reservation';
import Ticket from './pages/Ticket';
import StressTest from './pages/StressTest';
import LiveExperiment from './pages/LiveExperiment';
import Results from './pages/Results';
import Audit from './pages/Audit';

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
            <li><Link to="/" className="text-blue-600 hover:underline">Home</Link></li>
            <li><Link to="/event" className="text-blue-600 hover:underline">Event</Link></li>
            <li><Link to="/drop" className="text-blue-600 hover:underline">Drop</Link></li>
            <li><Link to="/queue" className="text-blue-600 hover:underline">Queue</Link></li>
            <li><Link to="/allocation" className="text-blue-600 hover:underline">Allocation</Link></li>
            <li><Link to="/reservation" className="text-blue-600 hover:underline">Reservation</Link></li>
            <li><Link to="/ticket" className="text-blue-600 hover:underline">Ticket</Link></li>
            <li><Link to="/stress-test" className="text-blue-600 hover:underline">StressTest</Link></li>
            <li><Link to="/live-experiment" className="text-blue-600 hover:underline">LiveExperiment</Link></li>
            <li><Link to="/results" className="text-blue-600 hover:underline">Results</Link></li>
            <li><Link to="/audit" className="text-blue-600 hover:underline">Audit</Link></li>
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
