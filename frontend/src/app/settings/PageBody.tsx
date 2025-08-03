"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateUserPassword, deleteUser, startUpdateEmail, verifyUpdateEmail } from "@/api/users";
import { logout, getSessionInfo } from "@/api/auth";

export default function PageBody() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    getSessionInfo()
      .then((session) => {
        if (!canceled) setUserId(session.userId);
      })
      .catch(() => {
        if (!canceled) setUserId(null);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailStep, setEmailStep] = useState<"input" | "verify" | "success">("input");
  const [updateEmailId, setUpdateEmailId] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [emailSuccessMsg, setEmailSuccessMsg] = useState<string | null>(null);

  async function handleStartUpdateEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailStep("input");
    setEmailSuccessMsg(null);
    if (!newEmail) {
      setEmailError("Please enter a new email address.");
      return;
    }
    if (!userId) {
      setEmailError("User information could not be retrieved. Please re-login.");
      return;
    }
    try {
      const { updateEmailId } = await startUpdateEmail(userId, newEmail);
      setUpdateEmailId(updateEmailId);
      setEmailStep("verify");
    } catch (e) {
      setEmailError(e ? String(e) : "Failed to start email update.");
    }
  }

  async function handleVerifyUpdateEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    if (!emailCode || !updateEmailId) {
      setEmailError("Please enter the verification code.");
      return;
    }
    if (!userId) {
      setEmailError("User information could not be retrieved. Please re-login.");
      return;
    }
    try {
      await verifyUpdateEmail(userId, updateEmailId, emailCode);
      localStorage.setItem("lastLoginEmail", newEmail);
      setEmailSuccessMsg("Email updated! Logging out…");
      setEmailStep("success");
      setTimeout(async () => {
        await logout();
        router.push("/login");
      }, 2000);
    } catch (e) {
      setEmailError(e ? String(e) : "Verification failed.");
    }
  }

  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (!pwNew || !pwNew2) {
      setPwError("Please fill in all password fields.");
      return;
    }
    if (pwNew !== pwNew2) {
      setPwError("The new passwords do not match.");
      return;
    }
    if (!userId) {
      setPwError("User information could not be retrieved. Please re-login.");
      return;
    }
    try {
      await updateUserPassword(userId, pwNew);
      setPwSuccess(true);
      setTimeout(async () => {
        await logout();
        router.push("/login");
      }, 2000);
    } catch (e) {
      setPwError(e ? String(e) : "Failed to change password.");
    }
  }

  const [withdrawalMode, setWithdrawalMode] = useState(false);
  const [withdrawalInput, setWithdrawalInput] = useState("");
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalSuccess, setWithdrawalSuccess] = useState(false);

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawalError(null);
    setWithdrawalSubmitting(true);
    if (withdrawalInput !== "withdrawal") {
      setWithdrawalError('Please type "withdrawal" to confirm.');
      setWithdrawalSubmitting(false);
      return;
    }
    if (!userId) {
      setWithdrawalError("User information could not be retrieved. Please re-login.");
      setWithdrawalSubmitting(false);
      return;
    }
    try {
      await deleteUser(userId);
      setWithdrawalSuccess(true);
      setTimeout(async () => {
        await logout();
        router.push("/login");
      }, 2000);
    } catch (e) {
      setWithdrawalError(e ? String(e) : "Failed to withdraw account.");
    } finally {
      setWithdrawalSubmitting(false);
    }
  }

  return (
    <main className="max-w-lg mx-auto mt-12 p-4 bg-white shadow">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Email Change */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-2">Change email address</h2>
        {emailStep === "input" && (
          <form onSubmit={handleStartUpdateEmail} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="New email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="border px-2 py-1 rounded"
              autoComplete="email"
            />
            {emailError && <div className="text-red-600">{emailError}</div>}
            <button type="submit" className="bg-blue-600 text-white px-4 py-1 rounded">
              Send verification code
            </button>
          </form>
        )}
        {emailStep === "verify" && (
          <form onSubmit={handleVerifyUpdateEmail} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Verification code"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value)}
              className="border px-2 py-1 rounded"
              autoComplete="one-time-code"
              autoFocus
            />
            {emailError && <div className="text-red-600">{emailError}</div>}
            <button type="submit" className="bg-blue-600 text-white px-4 py-1 rounded">
              Verify and update email
            </button>
          </form>
        )}
        {emailStep === "success" && emailSuccessMsg && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded">
            {emailSuccessMsg}
          </div>
        )}
      </section>

      {/* Password Change */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-2">Change password</h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="New password"
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            className="border px-2 py-1 rounded"
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={pwNew2}
            onChange={(e) => setPwNew2(e.target.value)}
            className="border px-2 py-1 rounded"
            autoComplete="new-password"
          />
          {pwError && <div className="text-red-600">{pwError}</div>}
          {pwSuccess && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded">
              Password changed! Logging out…
            </div>
          )}
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-1 rounded"
            disabled={pwSuccess}
          >
            Change password
          </button>
        </form>
      </section>

      {/* Withdrawal */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Withdrawal</h2>
        {!withdrawalMode ? (
          <div>
            <button
              className="bg-red-500 text-white px-4 py-1 rounded"
              onClick={() => setWithdrawalMode(true)}
            >
              Withdraw account
            </button>
            <div className="mt-2 text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">
              <b>Warning:</b> This will permanently delete your account and all data.
              <br />
              This action <b>cannot</b> be undone.
            </div>
          </div>
        ) : (
          <form onSubmit={handleWithdraw} className="flex flex-col gap-3">
            <div className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm mb-1">
              <b>Warning:</b> This will permanently delete your account and all data.
              <br />
              This action <b>cannot</b> be undone.
            </div>
            <label className="block mb-1">
              To confirm, type <span className="font-mono bg-gray-100 px-1">withdrawal</span> below
              and press &quot;Confirm withdrawal&quot;.
            </label>
            <input
              type="text"
              value={withdrawalInput}
              onChange={(e) => setWithdrawalInput(e.target.value)}
              className="border px-2 py-1 rounded"
              autoFocus
              disabled={withdrawalSubmitting || withdrawalSuccess}
            />
            {withdrawalError && <div className="text-red-600">{withdrawalError}</div>}
            {withdrawalSuccess && (
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded">
                Account withdrawn! Logging out…
              </div>
            )}
            <button
              type="submit"
              className="bg-red-500 text-white px-4 py-1 rounded"
              disabled={withdrawalSubmitting || withdrawalSuccess}
            >
              Confirm withdrawal
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
