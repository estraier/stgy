"use client";

import { useEffect, useState } from "react";

type HiddenField = {
  name: string;
  value: string;
};

type Props = {
  action: string;
  className: string;
  inputClassName: string;
  buttonClassName: string;
  defaultValue?: string;
  hiddenFields?: HiddenField[];
};

export default function PubSearchForm({
  action,
  className,
  inputClassName,
  buttonClassName,
  defaultValue = "",
  hiddenFields = [],
}: Props) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) return null;

  return (
    <form className={className} action={action} method="get">
      {hiddenFields.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
      <input
        className={inputClassName}
        type="search"
        name="q"
        defaultValue={defaultValue}
        aria-label="Search posts"
      />
      <button className={buttonClassName} type="submit" aria-label="Search posts">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M16 16l5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </form>
  );
}
