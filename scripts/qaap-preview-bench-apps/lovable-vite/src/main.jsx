import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
    const [count, setCount] = useState(0);
    return (
        <main>
            <h1>Lovable-style Vite fixture</h1>
            <button data-qaap-bench="counter" onClick={() => setCount(c => c + 1)}>count {count}</button>
        </main>
    );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
