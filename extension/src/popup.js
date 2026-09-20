import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
export default function Popup() {
    const [isReady, setIsReady] = useState(false);
    useEffect(() => {
        setIsReady(true);
    }, []);
    return (_jsx("div", { className: "w-96 h-64 bg-white flex flex-col items-center justify-center p-8", children: _jsxs("div", { className: "text-center", children: [_jsx("h1", { className: "text-5xl font-bold mb-4 text-black", children: "Hello" }), _jsx("p", { className: "text-lg text-black mb-6", children: "Bad Faith Article Auditor" }), isReady && (_jsxs("div", { className: "flex items-center justify-center gap-2 mt-6 text-base text-black", children: [_jsx("span", { className: "w-3 h-3 rounded-full bg-green-500 animate-pulse" }), _jsx("span", { children: "Ready to audit" })] }))] }) }));
}
