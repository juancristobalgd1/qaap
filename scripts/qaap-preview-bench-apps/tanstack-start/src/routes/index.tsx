import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
    const [count, setCount] = useState(0);
    return (
        <main>
            <h1 data-qaap-bench="ready">TanStack Start fixture</h1>
            <button data-qaap-bench="counter" onClick={() => setCount(c => c + 1)}>count {count}</button>
        </main>
    );
}
