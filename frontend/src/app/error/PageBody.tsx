"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";

export default function PageBody() {
  const params = useSearchParams();
  const code = params.get("code") || "Error";
  const message = params.get("message") || "Something went wrong.";

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-white">
      <AlertTriangle className="w-12 h-12 text-yellow-500 mb-3" />
      <div className="text-2xl font-bold mb-4">{code}</div>
      <p className="mb-6 text-gray-700">{message}</p>
      <Link href="/" className="text-blue-600 underline hover:text-blue-800">
        Back to Home
      </Link>
    </main>
  );
}
