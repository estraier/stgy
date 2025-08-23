"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startSignup, verifySignup } from "@/api/signup";

export default function PageBody() {
  const router = useRouter();
  const [step, setStep] = useState<"start" | "verify" | "success">("start");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [signupId, setSignupId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setError(null);
    if (!email || !password || !password2) {
      setError("Please fill in all fields.");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    try {
      const res = await startSignup(email, password);
      setSignupId(res.signupId);
      setStep("verify");
    } catch (e) {
      setError(e ? String(e) : "Signup start failed.");
    }
  };

  const handleVerify = async () => {
    setError(null);
    try {
      await verifySignup(signupId, verificationCode);
      setStep("success");
    } catch (e) {
      setError(e ? String(e) : "Verification failed.");
    }
  };

  return (
    <main className="max-w-md mx-auto mt-10 p-6 bg-white shadow rounded">
      <h1 className="text-2xl font-bold mb-4">Sign Up</h1>

      {step === "start" && (
        <>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              className="w-full px-3 py-2 border rounded"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border rounded"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">Confirm Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border rounded"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <button
            onClick={handleStart}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Send Verification Code
          </button>
        </>
      )}

      {step === "verify" && (
        <>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">
              Verification Code
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              required
            />
          </div>
          <button
            onClick={handleVerify}
            className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700"
          >
            Complete Sign Up
          </button>
        </>
      )}

      {step === "success" && (
        <div className="text-center py-10">
          <div className="text-green-700 text-lg font-semibold mb-2">Sign up completed!</div>
          <div className="mb-6">Your account has been created. Please log in.</div>
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={() => {
              if (typeof window !== "undefined") {
                localStorage.setItem("lastLoginEmail", email);
              }
              router.push("/login");
            }}
          >
            Go to Login
          </button>
        </div>
      )}

      {error && <div className="mt-4 text-red-600 text-sm text-center">{error}</div>}
    </main>
  );
}
