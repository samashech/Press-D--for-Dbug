import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, Bug, CheckCircle, Clock } from 'lucide-react';

const socket = io('http://localhost:3001');

function App() {
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    socket.on('init', (data) => setRuns(data));
    socket.on('update', (data) => {
      setRuns(prev => {
        const idx = prev.findIndex(r => r.id === data.id);
        if (idx === -1) return [data, ...prev];
        const next = [...prev];
        next[idx] = data;
        return next;
      });
    });
    return () => {
      socket.off('init');
      socket.off('update');
    };
  }, []);

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8 flex items-center gap-3">
        <Activity className="w-8 h-8 text-blue-600" />
        <h1 className="text-3xl font-bold text-gray-900">AutoQA Dashboard</h1>
      </header>
      
      <div className="grid gap-6">
        {runs.map(run => (
          <div key={run.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  {run.feature.name}
                  {run.status === 'passed' && <CheckCircle className="w-5 h-5 text-green-500" />}
                  {run.status === 'failed' && <Bug className="w-5 h-5 text-red-500" />}
                  {run.status === 'running' && <Activity className="w-5 h-5 text-blue-500 animate-pulse" />}
                  {run.status === 'queued' && <Clock className="w-5 h-5 text-gray-400" />}
                </h2>
                <p className="text-gray-600 mt-1">{run.feature.description}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                run.status === 'passed' ? 'bg-green-100 text-green-800' :
                run.status === 'failed' ? 'bg-red-100 text-red-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {run.status.toUpperCase()}
              </span>
            </div>

            {run.testCases && run.testCases[0]?.bugReports?.length > 0 && (
              <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-100">
                <h3 className="font-bold text-red-900 mb-2">Bug Report</h3>
                {run.testCases[0].bugReports.map((bug: any) => (
                  <div key={bug.id} className="text-sm">
                    <p className="font-semibold">{bug.title}</p>
                    <p className="mt-2"><span className="font-semibold text-red-800">Expected:</span> {bug.expected}</p>
                    <p className="mt-1"><span className="font-semibold text-red-800">Actual:</span> {bug.actual}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        
        {runs.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No test runs yet. Make a commit to see them appear here automatically!
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
