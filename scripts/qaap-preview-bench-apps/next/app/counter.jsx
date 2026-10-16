'use client';
import { useState } from 'react';

export default function Counter() {
    const [count, setCount] = useState(0);
    return (<button data-qaap-bench="counter" onClick={() => setCount(c => c + 1)}>count {count}</button>);
}
