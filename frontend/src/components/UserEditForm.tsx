"use client";

import React, { useState } from "react";
import type { UserDetail } from "@/api/models";
import { updateUser, getUserDetail } from "@/api/users";

type UserEditFormProps = {
  user: UserDetail;
  isAdmin: boolean;
  onUpdated?: (user: UserDetail) => void | Promise<void>;
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
  const [ai_personality, setAIPersonality] = useState(user.personality ?? "");
  const [ai_model, setAIModel] = useState(user.model ?? "");
  const [is_admin, setIsAdmin] = useState(user.is_admin ?? false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function handleClearError() {
    setError(null);
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
    if (ai_model && !ai_personality.trim()) {
      setError("AI Personality is required when an AI Model is set.");
      return;
    }
    if (introduction.trim() === "") {
      setError("Introduction is required.");
      return;
    }

    setSubmitting(true);
    try {
      const input: any = {
        nickname,
        introduction,
      };
      if (isAdmin) {
        input.email = email;
        input.is_admin = is_admin;
        input.ai_model = ai_model || null;
      }
      if (ai_model) {
        input.ai_personality = ai_personality;
      }

      await updateUser(user.id, input);

      // 必ず最新値をAPIで再取得する（updateUserの返り値でもOKならそれでも良い）
      const updatedUser = await getUserDetail(user.id, user.id); // ←2つめはfocusUserId(自分のID)でよい
      if (onUpdated) {
        await onUpdated(updatedUser);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to update user.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 border border-gray-300 rounded p-4 bg-white"
      onSubmit={handleSubmit}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex flex-col gap-1">
        <label className="font-bold text-sm">Email</label>
        <input
          className="border border-gray-400 rounded px-2 py-1 bg-gray-50"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={!isAdmin}
          required={isAdmin}
          onFocus={handleClearError}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-bold text-sm">Nickname</label>
        <input
          className="border border-gray-400 rounded px-2 py-1 bg-gray-50"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          required
          onFocus={handleClearError}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-bold text-sm">Introduction</label>
        <textarea
          className="border border-gray-400 rounded px-2 py-1 min-h-[64px] bg-gray-50"
          value={introduction}
          onChange={e => setIntroduction(e.target.value)}
          maxLength={2000}
          required
          onFocus={handleClearError}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-bold text-sm">AI Model</label>
        <input
          className="border border-gray-400 rounded px-2 py-1 bg-gray-50"
          value={ai_model}
          onChange={e => setAIModel(e.target.value)}
          disabled={!isAdmin}
          onFocus={handleClearError}
          placeholder="AI model name (optional)"
        />
      </div>
      {ai_model && (
        <div className="flex flex-col gap-1">
          <label className="font-bold text-sm">AI Personality</label>
          <input
            className="border border-gray-400 rounded px-2 py-1 bg-gray-50"
            value={ai_personality}
            onChange={e => setAIPersonality(e.target.value)}
            required
            onFocus={handleClearError}
            placeholder="Describe AI personality"
          />
        </div>
      )}
      {isAdmin && (
        <div className="flex flex-row items-center gap-2">
          <input
            type="checkbox"
            id="is_admin"
            checked={is_admin}
            onChange={e => setIsAdmin(e.target.checked)}
            className="mr-2"
            disabled={isSelf}
          />
          <label htmlFor="is_admin" className="font-semibold text-sm">Admin</label>
        </div>
      )}
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
        <button
          type="submit"
          className="bg-blue-400 text-white hover:bg-blue-500 px-4 py-1 rounded cursor-pointer ml-auto"
          disabled={submitting}
        >
          {submitting ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
