"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startResetPassword, verifyResetPassword } from "@/api/users";

export default function PageBody() {
  const router = useRouter();
  const [step, setStep] = useState<"start" | "verify" | "success">("start");
  const [email, setEmail] = useState("");
  const [resetPasswordId, setResetPasswordId] = useState("");
  const [webCode, setWebCode] = useState("");
  const [mailCode, setMailCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setError(null);
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    try {
      const res = await startResetPassword(email);
      setResetPasswordId(res.resetPasswordId);
      setWebCode(res.webCode); // 内部保持のみ
      setStep("verify");
    } catch (e) {
      setError(e ? String(e) : "Failed to start password reset.");
    }
  };

  const handleVerify = async () => {
    setError(null);
    if (!mailCode || !newPassword || !newPassword2) {
      setError("Please fill in all fields.");
      return;
    }
    if (newPassword !== newPassword2) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    try {
      await verifyResetPassword({
        email,
        resetPasswordId,
        webCode,
        mailCode,
        newPassword,
      });
      setStep("success");
    } catch (e) {
      setError(e ? String(e) : "Password reset failed.");
    }
  };

  return (
    <main className="max-w-md mx-auto mt-10 p-6 bg-white shadow rounded">
      <h1 className="text-2xl font-bold mb-4">Reset Password</h1>

      {step === "start" && (
        <>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">Email address</label>
            <input
              type="email"
              className="w-full px-3 py-2 border rounded"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <button
            onClick={handleStart}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Send Reset Code
          </button>
          <p className="mt-4 text-xs text-gray-600 text-center">
            Enter your email address and a reset code will be sent to you.
          </p>
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
              value={mailCode}
              onChange={(e) => setMailCode(e.target.value)}
              required
              autoComplete="one-time-code"
            />
            <p className="text-xs text-gray-500 mt-1">The code was sent to your email address.</p>
          </div>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">New Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border rounded"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="mb-4">
            <label className="block mb-1 text-sm font-medium text-gray-700">
              Confirm New Password
            </label>
            <input
              type="password"
              className="w-full px-3 py-2 border rounded"
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <button
            onClick={handleVerify}
            className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700"
          >
            Complete Password Reset
          </button>
        </>
      )}

      {step === "success" && (
        <div className="text-center py-10">
          <div className="text-green-700 text-lg font-semibold mb-2">Password Reset Completed!</div>
          <div className="mb-6">You can now log in with your new password.</div>
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
