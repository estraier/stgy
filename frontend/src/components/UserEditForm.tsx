"use client";

import React, { useEffect, useState } from "react";
import type { UserDetail } from "@/api/models";
import { updateUser, getUserDetail, deleteUser } from "@/api/users";
import { listAIModels } from "@/api/aiModels";
import Link from "next/link";

type UserEditFormProps = {
  user: UserDetail;
  isAdmin: boolean;
  isSelf: boolean;
  onUpdated?: (user?: UserDetail) => void | Promise<void>;
  onCancel: () => void;
};

export default function UserEditForm({
  user,
  isAdmin,
  isSelf,
  onUpdated,
  onCancel,
}: UserEditFormProps) {
  const [email, setEmail] = useState(user.email ?? "");
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [introduction, setIntroduction] = useState(user.introduction ?? "");
  const [aiPersonality, setAIPersonality] = useState(user.aiPersonality ?? "");
  const [aiModel, setAIModel] = useState(user.aiModel ?? "");
  const [admin, setIsAdmin] = useState(user.isAdmin ?? false);

  const [aiModels, setAIModels] = useState<{ name: string; description: string }[]>([]);
  const [aiModelsLoading, setAIModelsLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  useEffect(() => {
    setAIModelsLoading(true);
    listAIModels()
      .then(setAIModels)
      .catch(() => setAIModels([]))
      .finally(() => setAIModelsLoading(false));
  }, []);

  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function handleClearError() {
    setError(null);
  }

  async function handleDeleteUser(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await deleteUser(user.id);
      setDeleteSuccess(true);
      if (onUpdated) await onUpdated(undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isAdmin && !isValidEmail(email)) {
      setError("Invalid email address.");
      return;
    }
    if (!nickname.trim()) {
      setError("Nickname is required.");
      return;
    }
    if (aiModel && !aiPersonality.trim()) {
      setError("AI Personality is required when an AI Model is set.");
      return;
    }
    if (introduction.trim() === "") {
      setError("Introduction is required.");
      return;
    }
    setSubmitting(true);
    try {
      const input: Record<string, unknown> = {
        nickname,
        introduction,
      };
      if (isAdmin) {
        input.email = email;
        input.isAdmin = admin;
        input.aiModel = aiModel || null;
      }
      if (aiModel) {
        input.aiPersonality = aiPersonality;
      }

      await updateUser(user.id, input);

      const updatedUser = await getUserDetail(user.id, user.id);
      if (onUpdated) {
        await onUpdated(updatedUser);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update user.");
    } finally {
      setSubmitting(false);
    }
  }

  const canDelete = isAdmin && !isSelf && email.trim() === "";

  return (
    <form
      className="flex flex-col gap-2 border border-gray-300 rounded p-4 bg-white"
      onSubmit={canDelete ? handleDeleteUser : handleSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Email */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="font-bold text-sm">Email</label>
        </div>
        {isAdmin ? (
          <input
            className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700
                     focus:outline-none focus:ring-2 focus:ring-blue-200
                     disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!isAdmin}
            required={isAdmin && !isSelf && !canDelete}
            onFocus={handleClearError}
          />
        ) : (
          <div className="flex flex-row items-center gap-2">
            <span className="text-gray-700">{user.email}</span>
            {isSelf && (
              <Link
                href="/settings"
                className="text-blue-600 hover:underline text-xs opacity-70 hover:opacity-100"
                style={{ marginLeft: "8px" }}
              >
                (change)
              </Link>
            )}
          </div>
        )}
      </div>
      {/* Nickname */}
      <div className="flex flex-col gap-1">
        <label className="font-bold text-sm">Nickname</label>
        <input
          className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700
                     focus:outline-none focus:ring-2 focus:ring-blue-200
                     disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
          onFocus={handleClearError}
        />
      </div>
      {/* Introduction */}
      <div className="flex flex-col gap-1">
        <label className="font-bold text-sm">Introduction</label>
        <textarea
          className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50 text-gray-700
                     focus:outline-none focus:ring-2 focus:ring-blue-200
                     disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          value={introduction}
          onChange={(e) => setIntroduction(e.target.value)}
          maxLength={2000}
          required
          onFocus={handleClearError}
        />
      </div>
      {/* AI Model */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-row items-center justify-between">
          <label className="font-bold text-sm">AI Model</label>
          {!isAdmin && <span className="text-xs text-gray-400 ml-2">(Only admin can change)</span>}
        </div>
        {aiModelsLoading ? (
          <div className="text-gray-400 text-xs">Loading models…</div>
        ) : (
          <select
            className="border border-gray-400 rounded px-2 py-1 bg-gray-50 text-gray-700
                       focus:outline-none focus:ring-2 focus:ring-blue-200
                       disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            value={aiModel}
            onChange={(e) => setAIModel(e.target.value)}
            disabled={!isAdmin}
            onFocus={handleClearError}
          >
            <option value="">(None)</option>
            {aiModels.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
                {m.description ? ` - ${m.description}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      {/* AI Personality */}
      {aiModel && (
        <div className="flex flex-col gap-1">
          <label className="font-bold text-sm">AI Personality</label>
          <textarea
            className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50 text-gray-700
                       focus:outline-none focus:ring-2 focus:ring-blue-200
                       disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            value={aiPersonality}
            onChange={(e) => setAIPersonality(e.target.value)}
            required
            onFocus={handleClearError}
            placeholder="Describe AI personality"
            maxLength={2000}
          />
        </div>
      )}
      {/* Admin */}
      {isAdmin && (
        <div className="flex flex-row items-center gap-2">
          <input
            type="checkbox"
            id="isAdmin"
            checked={admin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="mr-2
              disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
            disabled={isSelf}
          />
          <label htmlFor="isAdmin" className="font-semibold text-sm">
            Admin
          </label>
          {isSelf && (
            <span className="text-xs text-gray-400 ml-1">
              (You can&#39;t change your own admin status)
            </span>
          )}
        </div>
      )}
      {/* Buttons and error */}
      <div className="flex items-center gap-2 mt-2">
        <span className="flex-1 text-red-600 text-sm">{error && error}</span>
        <button
          type="button"
          className="bg-gray-200 text-gray-700 px-4 py-1 rounded border border-gray-300 cursor-pointer hover:bg-gray-300 transition"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        {canDelete ? (
          <button
            type="submit"
            className="bg-red-500 text-white hover:bg-red-600 px-4 py-1 rounded cursor-pointer ml-auto"
            disabled={submitting || deleteSuccess}
          >
            {deleteSuccess ? "Deleted" : "Delete"}
          </button>
        ) : (
          <button
            type="submit"
            className="bg-blue-400 text-white hover:bg-blue-500 px-4 py-1 rounded cursor-pointer ml-auto"
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        )}
      </div>
      {canDelete && (
        <div className="text-xs text-red-700 mt-2">
          This will <b>permanently delete</b> this user and all their data.
          <br />
          Are you sure?
        </div>
      )}
    </form>
  );
}
